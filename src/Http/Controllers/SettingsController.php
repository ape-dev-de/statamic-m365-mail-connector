<?php

namespace ApeDev\M365Mailer\Http\Controllers;

use ApeDev\M365Mailer\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Statamic\Facades\User;

class SettingsController
{
    public function index()
    {
        $this->authorizeSuper();

        $config = $this->mailerConfig();
        $proxy = $config['proxy_redirect_uri'] ?? null;

        return view('m365-mailer::cp.settings', [
            'configured' => $this->isConfigured($config),
            'isDefaultMailer' => config('mail.default') === 'microsoft-graph',
            'tenantId' => $config['tenant_id'] ?? null,
            'clientId' => $config['client_id'] ?? null,
            'fromAddress' => config('mail.from.address'),
            'proxyConfigured' => filled($proxy),
            'registeredRedirectUri' => $proxy ?: cp_route('m365-mailer.callback'),
            'siteCallbackUri' => cp_route('m365-mailer.callback'),
            'connection' => Settings::connection(),
            'fromMailbox' => Settings::fromMailbox(),
        ]);
    }

    public function consent(Request $request)
    {
        $this->authorizeSuper();

        $config = $this->mailerConfig();

        if (! $this->isConfigured($config)) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('Set M365_TENANT_ID, M365_CLIENT_ID and the certificate before connecting.'));
        }

        $proxy = $config['proxy_redirect_uri'] ?? null;
        $secret = $config['proxy_secret'] ?? null;

        if ($proxy && ! $secret) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('M365_PROXY_REDIRECT_URI is set but M365_PROXY_SECRET is missing.'));
        }

        $tenant = ($config['tenant_id'] ?? null) ?: $this->tenantFromSender();

        if (! $tenant) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('Set a sender mailbox (or MAIL_FROM_ADDRESS) so the tenant can be resolved.'));
        }

        $nonce = Str::random(40);
        $request->session()->put('m365_consent_nonce', $nonce);

        // redirect_uri = the single proxy URL registered on the app. The real CP
        // callback travels inside the (HMAC-signed) state; the proxy forwards there.
        $redirectUri = $proxy ?: cp_route('m365-mailer.callback');
        $state = $this->buildState(cp_route('m365-mailer.callback'), $nonce, $secret ?: config('app.key'));

        $url = "https://login.microsoftonline.com/{$tenant}/adminconsent?".http_build_query([
            'client_id' => $config['client_id'],
            'redirect_uri' => $redirectUri,
            'state' => $state,
        ]);

        return redirect()->away($url);
    }

    public function callback(Request $request)
    {
        $this->authorizeSuper();

        $config = $this->mailerConfig();
        $secret = ($config['proxy_secret'] ?? null) ?: config('app.key');

        $nonce = $request->session()->pull('m365_consent_nonce');
        $payload = $this->verifyState((string) $request->query('state'), $secret);

        if (! $nonce || ! $payload || ! hash_equals($nonce, $payload['nonce'] ?? '')) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('Consent state mismatch — please retry.'));
        }

        if ($request->filled('error')) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', $request->query('error_description', $request->query('error')));
        }

        if ($request->query('admin_consent') !== 'True') {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('Admin consent was not granted.'));
        }

        Settings::put(['connection' => [
            'tenant' => $request->query('tenant'),
            'consented_at' => now()->toIso8601String(),
            'consented_by' => User::current()?->email(),
        ]]);

        return redirect()->route('statamic.cp.m365-mailer.index')
            ->with('success', __('Microsoft 365 connected — admin consent granted.'));
    }

    public function saveMailbox(Request $request)
    {
        $this->authorizeSuper();

        $mailbox = trim((string) $request->input('from_mailbox'));

        if ($mailbox !== '' && ! filter_var($mailbox, FILTER_VALIDATE_EMAIL)) {
            return back()->with('error', __('Enter a valid email address, or leave empty for "all / decide per form".'));
        }

        Settings::put(['from_mailbox' => $mailbox ?: null]);

        return back()->with('success', $mailbox === ''
            ? __('Sender set to "all / decide per form".')
            : __('Sender mailbox saved: :address.', ['address' => $mailbox]));
    }

    public function test()
    {
        $this->authorizeSuper();

        $recipient = Settings::fromMailbox() ?: config('mail.from.address');

        try {
            Mail::mailer('microsoft-graph')->raw(
                __('Test message from the Ape Dev Microsoft 365 connector.'),
                fn ($message) => $message->to($recipient)->subject(__('Microsoft 365 connector test'))
            );
        } catch (\Throwable $e) {
            return back()->with('error', __('Test send failed: ').$e->getMessage());
        }

        return back()->with('success', __('Test email sent to :address.', ['address' => $recipient]));
    }

    private function mailerConfig(): array
    {
        return config('mail.mailers.microsoft-graph', []);
    }

    private function isConfigured(array $config): bool
    {
        // tenant_id is optional — autodiscovered from consent or the sender domain.
        return filled($config['client_id'] ?? null)
            && (filled($config['certificate_path'] ?? null) || filled($config['certificate'] ?? null));
    }

    private function tenantFromSender(): ?string
    {
        $sender = Settings::fromMailbox() ?: config('mail.from.address');

        return $sender && str_contains($sender, '@') ? Str::after($sender, '@') : null;
    }

    private function authorizeSuper(): void
    {
        abort_unless(User::current()?->isSuper(), 403);
    }

    private function buildState(string $origin, string $nonce, string $secret): string
    {
        $body = $this->b64UrlEncode(json_encode([
            'origin' => $origin,
            'nonce' => $nonce,
            'ts' => time(),
        ]));

        return $body.'.'.$this->b64UrlEncode(hash_hmac('sha256', $body, $secret, true));
    }

    private function verifyState(string $state, string $secret): ?array
    {
        if (! str_contains($state, '.')) {
            return null;
        }

        [$body, $signature] = explode('.', $state, 2);

        if (! hash_equals($this->b64UrlEncode(hash_hmac('sha256', $body, $secret, true)), $signature)) {
            return null;
        }

        $payload = json_decode($this->b64UrlDecode($body), true);

        if (! is_array($payload) || (time() - ($payload['ts'] ?? 0)) > 3600) {
            return null;
        }

        return $payload;
    }

    private function b64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function b64UrlDecode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'), true);
    }
}
