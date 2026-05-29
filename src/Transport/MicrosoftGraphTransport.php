<?php

namespace ApeDev\M365Mailer\Transport;

use ApeDev\M365Mailer\Support\Settings;
use Illuminate\Support\Facades\Http;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\MessageConverter;

/**
 * Sends mail through the central Ape Dev relay instead of calling Microsoft Graph
 * directly. The signing certificate and Graph credentials live ONLY at the relay;
 * this box holds nothing but a per-tenant capability token (obtained at admin
 * consent), so a leak here can at most send mail for this one tenant.
 */
class MicrosoftGraphTransport extends AbstractTransport
{
    /**
     * @param  (\Closure(): ?string)|null  $fromResolver  Returns the mailbox to pin "From" to, or null to leave it.
     */
    public function __construct(
        private readonly string $relayUrl,
        private readonly ?string $relayToken = null,
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
            throw new TransportException('M365 mailer: message has no "From" address; it must be a mailbox in the connected tenant.');
        }

        // Durable env/Secret override wins; otherwise the token stored at consent.
        $token = $this->relayToken ?: Settings::relayToken();
        if (! $token) {
            throw new TransportException('M365 mailer: not connected — grant admin consent in the Control Panel first.');
        }

        $response = Http::withToken($token)
            ->acceptJson()
            ->asJson()
            ->post(rtrim($this->relayUrl, '/').'/send', [
                'from' => $from[0]->getAddress(),
                'message' => $this->toGraphMessage($email),
                'saveToSentItems' => $this->saveToSentItems,
            ]);

        if ($response->failed()) {
            throw new TransportException(
                "M365 mailer: relay send failed ({$response->status()}): ".$response->body()
            );
        }
    }

    public function __toString(): string
    {
        return 'microsoft-graph';
    }

    /**
     * If a sender mailbox is configured in the CP, force it as "From". Any prior
     * sender is demoted to Reply-To so the original address (e.g. a contact-form
     * visitor) stays reachable.
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
}
