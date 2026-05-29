<?php

namespace ApeDev\M365Mailer\Http\Controllers;

use ApeDev\M365Mailer\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Statamic\Facades\User;

class SettingsController
{
    public function index()
    {
        $this->authorizeSuper();

        $config = $this->mailerConfig();

        $envToken = $config['relay_token'] ?? null;
        $stateToken = Settings::relayToken();

        return Inertia::render('m365-mailer::Settings', [
            'configured' => $this->isConfigured($config),
            'connected' => filled($envToken) || $stateToken !== null,
            'connection' => Settings::connection(),
            'relayUrl' => $config['relay_url'] ?? null,
            'tenantId' => $config['tenant_id'] ?? null,
            'fromAddress' => config('mail.from.address'),
            'isDefaultMailer' => config('mail.default') === 'microsoft-graph',
            // 'env' = durable (Secret); 'runtime' = state.json (needs a persistent volume)
            'tokenSource' => filled($envToken) ? 'env' : ($stateToken !== null ? 'runtime' : null),
            'tokenTtlDays' => Settings::tokenTtlDays(),
            'urls' => [
                'consent' => cp_route('m365-mailer.consent'),
                'test' => cp_route('m365-mailer.test'),
                'ttl' => cp_route('m365-mailer.ttl'),
            ],
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

        // Multi-tenant admin consent: "common" lets the admin consent for THEIR
        // tenant; Microsoft returns the real tenant GUID in the callback (the relay
        // then uses that GUID to send). An explicit M365_TENANT_ID overrides.
        $tenant = ($config['tenant_id'] ?? null) ?: 'common';

        $nonce = Str::random(40);
        $request->session()->put('m365_consent_nonce', $nonce);

        // redirect_uri = the relay (registered once on the app). The relay verifies
        // the return origin against its allowlist, mints a per-tenant capability
        // token, and forwards it back to this CP callback inside the redirect.
        $url = "https://login.microsoftonline.com/{$tenant}/adminconsent?".http_build_query([
            'client_id' => $config['client_id'],
            'redirect_uri' => $this->relayCallbackUrl($config),
            'state' => $this->encodeState(cp_route('m365-mailer.callback'), $nonce, Settings::tokenTtlDays()),
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

    public function saveTtl(Request $request)
    {
        $this->authorizeSuper();

        $days = (int) $request->input('token_ttl_days');

        if (! in_array($days, [0, 365, 730, 1825], true)) {
            return back()->with('error', __('Invalid token lifetime.'));
        }

        Settings::put(['token_ttl_days' => $days]);

        return back()->with('success', __('Token lifetime saved. It applies at the next consent.'));
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

    private function authorizeSuper(): void
    {
        abort_unless(User::current()?->isSuper(), 403);
    }

    // state carries the return origin + a CSRF nonce. No signature here: the relay
    // guards open-redirect via its origin allowlist, and the nonce is validated
    // against this box's session on return.
    private function encodeState(string $origin, string $nonce, int $ttlDays): string
    {
        return $this->b64UrlEncode(json_encode([
            'origin' => $origin,
            'nonce' => $nonce,
            'ts' => time(),
            'ttl_days' => $ttlDays,
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
