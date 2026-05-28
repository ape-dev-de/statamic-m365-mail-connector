<?php

namespace ApeDev\M365Mailer;

use ApeDev\M365Mailer\Transport\MicrosoftGraphTransport;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\ServiceProvider;
use InvalidArgumentException;

class M365MailerServiceProvider extends ServiceProvider
{
    public function boot(): void
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
            );
        });
    }
}
