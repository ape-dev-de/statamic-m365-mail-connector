<?php

namespace ApeDev\M365Mailer\Transport;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\MessageConverter;

/**
 * Sends mail through the Microsoft Graph API using app-only (client credentials)
 * auth with a certificate. The signing certificate is read from the PEM mounted
 * into the container; the x5t header is derived from it, so certificate rotation
 * is transparent as long as the deployed cert is one of the trusted keyCredentials
 * on the app registration.
 */
class MicrosoftGraphTransport extends AbstractTransport
{
    private const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

    /**
     * @param  (\Closure(): ?string)|null  $fromResolver  Returns the mailbox to pin "From" to, or null to leave it.
     */
    public function __construct(
        private readonly string $tenantId,
        private readonly string $clientId,
        private readonly ?string $certificatePath = null,
        private readonly ?string $certificate = null,
        private readonly bool $saveToSentItems = false,
        private readonly ?\Closure $fromResolver = null,
    ) {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        $email = MessageConverter::toEmail($message->getOriginalMessage());

        $this->pinFrom($email);

        $from = $email->getFrom();
        if ($from === []) {
            throw new TransportException('M365 mailer: message has no "From" address; it must equal the licensed mailbox.');
        }
        $sender = $from[0]->getAddress();

        $response = Http::withToken($this->accessToken())
            ->acceptJson()
            ->asJson()
            ->post(self::GRAPH_BASE.'/users/'.rawurlencode($sender).'/sendMail', [
                'message' => $this->toGraphMessage($email),
                'saveToSentItems' => $this->saveToSentItems,
            ]);

        if ($response->failed()) {
            throw new TransportException(
                "M365 mailer: Graph sendMail failed ({$response->status()}): ".$response->body()
            );
        }
    }

    public function __toString(): string
    {
        return 'microsoft-graph';
    }

    /**
     * If a sender mailbox is configured in the CP, force it as "From" (Graph sends
     * via /users/{from}/sendMail). Any prior sender is demoted to Reply-To so the
     * original address (e.g. a contact-form visitor) stays reachable.
     */
    private function pinFrom(Email $email): void
    {
        $mailbox = $this->fromResolver ? ($this->fromResolver)() : null;

        if (! $mailbox) {
            return;
        }

        $current = $email->getFrom();

        if ($current !== [] && strcasecmp($current[0]->getAddress(), $mailbox) !== 0 && $email->getReplyTo() === []) {
            $email->replyTo($current[0]);
        }

        $email->from(new Address($mailbox));
    }

    private function toGraphMessage(Email $email): array
    {
        $html = $email->getHtmlBody();
        $body = $html !== null
            ? ['contentType' => 'HTML', 'content' => (string) $html]
            : ['contentType' => 'Text', 'content' => (string) $email->getTextBody()];

        return array_filter([
            'subject' => $email->getSubject() ?? '',
            'body' => $body,
            'toRecipients' => $this->recipients($email->getTo()),
            'ccRecipients' => $this->recipients($email->getCc()),
            'bccRecipients' => $this->recipients($email->getBcc()),
            'replyTo' => $this->recipients($email->getReplyTo()),
            'attachments' => $this->attachments($email),
        ], static fn ($value) => $value !== []);
    }

    /**
     * @param  Address[]  $addresses
     */
    private function recipients(array $addresses): array
    {
        return array_map(static fn (Address $address) => [
            'emailAddress' => array_filter([
                'address' => $address->getAddress(),
                'name' => $address->getName() ?: null,
            ], static fn ($value) => $value !== null),
        ], $addresses);
    }

    private function attachments(Email $email): array
    {
        $attachments = [];

        foreach ($email->getAttachments() as $part) {
            $headers = $part->getPreparedHeaders();
            $disposition = $headers->getHeaderBody('Content-Disposition');
            $contentId = $headers->getHeaderBody('Content-ID');

            $attachments[] = array_filter([
                '@odata.type' => '#microsoft.graph.fileAttachment',
                'name' => $headers->getHeaderParameter('Content-Disposition', 'filename') ?? 'attachment',
                'contentType' => $part->getMediaType().'/'.$part->getMediaSubtype(),
                'contentBytes' => base64_encode($part->getBody()),
                'isInline' => $disposition === 'inline',
                'contentId' => $contentId ? trim((string) $contentId, '<>') : null,
            ], static fn ($value) => $value !== null);
        }

        return $attachments;
    }

    private function accessToken(): string
    {
        $cacheKey = "m365-mailer:token:{$this->tenantId}:{$this->clientId}";

        if ($token = Cache::get($cacheKey)) {
            return $token;
        }

        $tokenUrl = "https://login.microsoftonline.com/{$this->tenantId}/oauth2/v2.0/token";

        $response = Http::asForm()->post($tokenUrl, [
            'client_id' => $this->clientId,
            'scope' => 'https://graph.microsoft.com/.default',
            'grant_type' => 'client_credentials',
            'client_assertion_type' => 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            'client_assertion' => $this->clientAssertion($tokenUrl),
        ]);

        if ($response->failed()) {
            throw new TransportException(
                "M365 mailer: token request failed ({$response->status()}): ".$response->body()
            );
        }

        $token = (string) $response->json('access_token');
        $ttl = max(60, (int) $response->json('expires_in', 3600) - 300);
        Cache::put($cacheKey, $token, $ttl);

        return $token;
    }

    private function clientAssertion(string $audience): string
    {
        $pem = $this->certificatePem();

        if (! preg_match('/-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----/s', $pem, $match)) {
            throw new TransportException('M365 mailer: certificate PEM must contain the public certificate (key + cert).');
        }

        $thumbprint = openssl_x509_fingerprint($match[0], 'sha1', true);
        if ($thumbprint === false) {
            throw new TransportException('M365 mailer: could not read certificate fingerprint.');
        }

        $privateKey = openssl_pkey_get_private($pem);
        if ($privateKey === false) {
            throw new TransportException('M365 mailer: certificate PEM does not contain a usable private key.');
        }

        $now = time();
        $header = ['alg' => 'RS256', 'typ' => 'JWT', 'x5t' => $this->base64Url($thumbprint)];
        $claims = [
            'aud' => $audience,
            'iss' => $this->clientId,
            'sub' => $this->clientId,
            'jti' => (string) Str::uuid(),
            'nbf' => $now,
            'exp' => $now + 300,
            'iat' => $now,
        ];

        $signingInput = $this->base64Url(json_encode($header)).'.'.$this->base64Url(json_encode($claims));

        if (! openssl_sign($signingInput, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new TransportException('M365 mailer: failed to sign client assertion.');
        }

        return $signingInput.'.'.$this->base64Url($signature);
    }

    private function certificatePem(): string
    {
        if ($this->certificatePath !== null) {
            $pem = @file_get_contents($this->certificatePath);
            if ($pem === false) {
                throw new TransportException("M365 mailer: cannot read certificate at [{$this->certificatePath}].");
            }

            return $pem;
        }

        $raw = (string) $this->certificate;

        return str_contains($raw, '-----BEGIN') ? $raw : (string) base64_decode($raw, true);
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
