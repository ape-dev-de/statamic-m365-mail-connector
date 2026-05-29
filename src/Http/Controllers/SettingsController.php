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

        $envToken = $config['relay_token'] ?? null;
        $stateToken = Settings::relayToken();

        return view('m365-mailer::cp.settings', [
            'configured' => $this->isConfigured($config),
            'isDefaultMailer' => config('mail.default') === 'microsoft-graph',
            'clientId' => $config['client_id'] ?? null,
            'tenantId' => $config['tenant_id'] ?? null,
            'fromAddress' => config('mail.from.address'),
            'relayUrl' => $config['relay_url'] ?? null,
            'relayCallback' => $this->relayCallbackUrl($config),
            'connection' => Settings::connection(),
            'connected' => filled($envToken) || $stateToken !== null,
            // 'env' = durable (Secret); 'runtime' = state.json (needs a persistent volume)
            'tokenSource' => filled($envToken) ? 'env' : ($stateToken !== null ? 'runtime' : null),
            'fromMailbox' => Settings::fromMailbox(),
        ]);
    }

    public function consent(Request $request)
    {
        $this->authorizeSuper();

        $config = $this->mailerConfig();

        if (! $this->isConfigured($config)) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('Set M365_CLIENT_ID and M365_RELAY_URL before connecting.'));
        }

        $tenant = ($config['tenant_id'] ?? null) ?: $this->tenantFromSender();

        if (! $tenant) {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('Set a sender mailbox (or MAIL_FROM_ADDRESS) so the tenant can be resolved.'));
        }

        $nonce = Str::random(40);
        $request->session()->put('m365_consent_nonce', $nonce);

        // redirect_uri = the relay (registered once on the app). The relay verifies
        // the return origin against its allowlist, mints a per-tenant capability
        // token, and forwards it back to this CP callback inside the redirect.
        $url = "https://login.microsoftonline.com/{$tenant}/adminconsent?".http_build_query([
            'client_id' => $config['client_id'],
            'redirect_uri' => $this->relayCallbackUrl($config),
            'state' => $this->encodeState(cp_route('m365-mailer.callback'), $nonce),
        ]);

        return redirect()->away($url);
    }

    public function callback(Request $request)
    {
        $this->authorizeSuper();

        $nonce = $request->session()->pull('m365_consent_nonce');
        $payload = $this->decodeState((string) $request->query('state'));

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

        $token = (string) $request->query('cap');
        if ($token === '') {
            return redirect()->route('statamic.cp.m365-mailer.index')
                ->with('error', __('The relay did not return a capability token.'));
        }

        Settings::put([
            'connection' => [
                'tenant' => $request->query('tenant'),
                'consented_at' => now()->toIso8601String(),
                'consented_by' => User::current()?->email(),
            ],
            'relay_token' => $token,
        ]);

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
        // The certificate lives only at the relay; this box just needs to know
        // the shared client_id (for the consent URL) and the relay URL.
        return filled($config['client_id'] ?? null) && filled($config['relay_url'] ?? null);
    }

    private function relayCallbackUrl(array $config): ?string
    {
        return filled($config['relay_url'] ?? null)
            ? rtrim($config['relay_url'], '/').'/callback'
            : null;
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

    // state carries the return origin + a CSRF nonce. No signature here: the relay
    // guards open-redirect via its origin allowlist, and the nonce is validated
    // against this box's session on return.
    private function encodeState(string $origin, string $nonce): string
    {
        return $this->b64UrlEncode(json_encode([
            'origin' => $origin,
            'nonce' => $nonce,
            'ts' => time(),
        ]));
    }

    private function decodeState(string $state): ?array
    {
        $payload = json_decode($this->b64UrlDecode($state), true);

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
