<?php

namespace ApeDev\M365Mailer\Support;

use Illuminate\Support\Facades\File;

/**
 * Tiny flat-file store for connector state set from the CP: admin-consent result
 * and the selected "send from" mailbox. Lives under storage/, not in env, so the
 * admin can change it at runtime without a redeploy.
 */
class Settings
{
    public static function path(): string
    {
        return storage_path('m365-mailer/state.json');
    }

    public static function all(): array
    {
        return File::exists($path = self::path())
            ? (json_decode(File::get($path), true) ?: [])
            : [];
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::all()[$key] ?? $default;
    }

    public static function put(array $merge): void
    {
        File::ensureDirectoryExists(dirname(self::path()));
        File::put(self::path(), json_encode(array_merge(self::all(), $merge), JSON_PRETTY_PRINT));
    }

    public static function connection(): ?array
    {
        return self::get('connection');
    }

    /**
     * Selected sender mailbox, or null when the admin chose "all / decide per form".
     */
    public static function fromMailbox(): ?string
    {
        $value = self::get('from_mailbox');

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Per-tenant capability token issued by the relay at admin consent. Presented
     * on every /send; scoped to this tenant, so a leak here is limited to it.
     */
    public static function relayToken(): ?string
    {
        $value = self::get('relay_token');

        return is_string($value) && $value !== '' ? $value : null;
    }
}
