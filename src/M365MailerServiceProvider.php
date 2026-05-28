<?php

namespace ApeDev\M365Mailer;

use ApeDev\M365Mailer\Support\Settings;
use ApeDev\M365Mailer\Transport\MicrosoftGraphTransport;
use Illuminate\Support\Facades\Mail;
use InvalidArgumentException;
use Statamic\Facades\CP\Nav;
use Statamic\Facades\User;
use Statamic\Providers\AddonServiceProvider;

class M365MailerServiceProvider extends AddonServiceProvider
{
    protected $routes = [
        'cp' => __DIR__.'/../routes/cp.php',
    ];

    protected $viewNamespace = 'm365-mailer';

    public function boot()
    {
        // Register the mail transport unconditionally (web, queue and console),
        // independent of Statamic's CP boot lifecycle.
        $this->registerMailTransport();

        parent::boot();
    }

    public function bootAddon()
    {
        Nav::extend(function ($nav) {
            if (! User::current()?->isSuper()) {
                return;
            }

            $nav->create(__('Microsoft 365'))
                ->section(__('Settings'))
                ->route('m365-mailer.index')
                ->icon('mail');
        });
    }

    private function registerMailTransport(): void
    {
        Mail::extend('microsoft-graph', function (array $config) {
            foreach (['tenant_id', 'client_id'] as $required) {
                if (empty($config[$required])) {
                    throw new InvalidArgumentException("M365 mailer: missing required config [{$required}].");
                }
            }

            if (empty($config['certificate_path']) && empty($config['certificate'])) {
                throw new InvalidArgumentException(
                    'M365 mailer: provide either [certificate_path] (mounted PEM) or [certificate] (base64/PEM).'
                );
            }

            return new MicrosoftGraphTransport(
                tenantId: $config['tenant_id'],
                clientId: $config['client_id'],
                certificatePath: $config['certificate_path'] ?? null,
                certificate: $config['certificate'] ?? null,
                saveToSentItems: (bool) ($config['save_to_sent_items'] ?? false),
                fromResolver: fn () => Settings::fromMailbox(),
            );
        });
    }
}
