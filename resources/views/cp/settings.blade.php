@extends('statamic::layout')
@section('title', __('Microsoft 365'))

@php
    $card = 'background:var(--color-content-bg,#fff); border:1px solid var(--color-content-border,#e3e8ef); border-radius:.75rem; padding:1.25rem 1.5rem; margin-bottom:1.25rem;';
    $muted = 'color:var(--color-gray-500,#6b7280);';
    $inset = 'background:var(--color-body-bg,#f3f4f6); border:1px solid var(--color-content-border,#e3e8ef); border-radius:.4rem;';
    $btnPrimary = 'display:inline-block; padding:.55rem 1.1rem; border-radius:.5rem; background:var(--color-ui-accent-bg,#2563eb); color:var(--color-ui-accent-text,#fff); text-decoration:none; font-weight:600; border:none; cursor:pointer;';
    $btnNeutral = 'padding:.55rem 1.1rem; border-radius:.5rem; background:var(--color-content-bg,#fff); color:inherit; border:1px solid var(--color-content-border,#d1d5db); font-weight:600; cursor:pointer;';
    $field = 'flex:1; padding:.5rem .75rem; border:1px solid var(--color-content-border,#d1d5db); border-radius:.5rem; background:var(--color-body-bg,#fff); color:inherit;';
@endphp

@section('content')
    <div style="max-width: 720px;">
        <h1 style="margin-bottom: 1.5rem;">{{ __('Microsoft 365 E-Mail') }}</h1>

        @foreach (['success' => 'var(--color-green-500,#22a559)', 'error' => 'var(--color-red-500,#dc2626)'] as $type => $accent)
            @if (session($type))
                <div style="padding:.75rem 1rem; margin-bottom:1rem; border-radius:.5rem; {{ $card }} border-left:3px solid {{ $accent }};">
                    {{ session($type) }}
                </div>
            @endif
        @endforeach

        <div style="{{ $card }}">
            <div style="display:flex; align-items:center; gap:.5rem; margin-bottom:1rem;">
                @if ($connected)
                    <span style="display:inline-block; width:.6rem; height:.6rem; border-radius:50%; background:var(--color-green-500,#22a559);"></span>
                    <strong>{{ __('Connected') }}</strong>
                    @if ($connection['consented_at'] ?? null)
                        <span style="{{ $muted }}">— {{ __('admin consent granted') }} {{ \Illuminate\Support\Carbon::parse($connection['consented_at'])->diffForHumans() }}</span>
                    @endif
                @else
                    <span style="display:inline-block; width:.6rem; height:.6rem; border-radius:50%; background:var(--color-gray-400,#d1d5db);"></span>
                    <strong>{{ __('Not connected') }}</strong>
                    <span style="{{ $muted }}">— {{ __('an admin must grant consent once') }}</span>
                @endif
            </div>

            @if ($tokenSource === 'runtime')
                <div style="padding:.6rem .85rem; margin-bottom:1rem; border-radius:.5rem; {{ $inset }} border-left:3px solid var(--color-amber-500,#d97706); font-size:.85rem;">
                    {{ __('Token is stored in storage/m365-mailer/ — make sure that path is on a persistent volume, or set M365_RELAY_TOKEN (k8s Secret) so it survives redeploys.') }}
                </div>
            @endif

            <dl style="display:grid; grid-template-columns:180px 1fr; gap:.4rem 1rem; font-size:.875rem; margin:0;">
                <dt style="{{ $muted }}">{{ __('Relay') }}</dt>
                <dd style="margin:0; font-family:monospace;">{{ $relayUrl ?: '—' }}</dd>

                <dt style="{{ $muted }}">{{ __('Tenant') }}</dt>
                <dd style="margin:0; font-family:monospace;">
                    @if ($tenantId)
                        {{ $tenantId }}
                    @elseif ($connection['tenant'] ?? null)
                        {{ $connection['tenant'] }} <span style="{{ $muted }}">({{ __('from consent') }})</span>
                    @else
                        <span style="{{ $muted }}">{{ __('resolved at consent (common)') }}</span>
                    @endif
                </dd>

                <dt style="{{ $muted }}">{{ __('From / mailbox') }}</dt>
                <dd style="margin:0; font-family:monospace;">{{ $fromAddress ?: '—' }}</dd>

                <dt style="{{ $muted }}">{{ __('Default mailer') }}</dt>
                <dd style="margin:0;">{{ $isDefaultMailer ? __('yes') : __('no (set MAIL_MAILER=microsoft-graph)') }}</dd>
            </dl>
        </div>

        @unless ($configured)
            <div style="padding:.75rem 1rem; margin-bottom:1.25rem; border-radius:.5rem; {{ $inset }} border-left:3px solid var(--color-amber-500,#d97706);">
                {{ __('Set M365_CLIENT_ID and M365_RELAY_URL in the environment before connecting.') }}
            </div>
        @endunless

        <div style="{{ $card }}">
            <h2 style="font-size:1rem; margin:0 0 .25rem;">{{ __('Sender mailbox') }}</h2>
            <p style="{{ $muted }} font-size:.875rem; margin:0 0 .75rem;">
                {{ __('Mailbox the connector sends from. Leave empty for "all / decide per form" — then the From comes from each form or the global mail config.') }}
            </p>
            <form method="POST" action="{{ cp_route('m365-mailer.mailbox') }}" style="display:flex; gap:.5rem; align-items:center; margin:0;">
                @csrf
                <input type="email" name="from_mailbox" value="{{ $fromMailbox }}" placeholder="kontakt@festglanz.de"
                       style="{{ $field }} font-family:monospace;">
                <button type="submit" style="{{ $btnNeutral }}">{{ __('Save') }}</button>
            </form>
        </div>

        <div style="{{ $card }}">
            <h2 style="font-size:1rem; margin:0 0 .25rem;">{{ __('Token lifetime') }}</h2>
            <p style="{{ $muted }} font-size:.875rem; margin:0 0 .75rem;">
                {{ __('How long the capability token stays valid. Applies at the next consent. The relay may cap this.') }}
            </p>
            <form method="POST" action="{{ cp_route('m365-mailer.ttl') }}" style="display:flex; gap:.5rem; align-items:center; margin:0;">
                @csrf
                <select name="token_ttl_days" style="{{ $field }}">
                    @foreach ([0 => __('Unlimited'), 365 => __('1 year'), 730 => __('2 years'), 1825 => __('5 years')] as $days => $label)
                        <option value="{{ $days }}" {{ $tokenTtlDays === $days ? 'selected' : '' }}>{{ $label }}</option>
                    @endforeach
                </select>
                <button type="submit" style="{{ $btnNeutral }}">{{ __('Save') }}</button>
            </form>
            @if ($tokenTtlDays === 0)
                <p style="{{ $muted }} font-size:.8125rem; margin:.6rem 0 0;">
                    {{ __('Unlimited is safe only if the relay supports per-tenant revocation — otherwise a leaked token can only be killed by rotating the relay signing secret (affects all tenants).') }}
                </p>
            @endif
        </div>

        <div style="display:flex; gap:.75rem; align-items:center;">
            <a href="{{ cp_route('m365-mailer.consent') }}"
               style="{{ $btnPrimary }} {{ $configured ? '' : 'opacity:.5; pointer-events:none;' }}">
                {{ $connected ? __('Re-grant admin consent') : __('Connect Microsoft 365 (admin consent)') }}
            </a>

            <form method="POST" action="{{ cp_route('m365-mailer.test') }}" style="margin:0;">
                @csrf
                <button type="submit" style="{{ $btnNeutral }} {{ ($configured && $connected) ? '' : 'opacity:.5; pointer-events:none;' }}">
                    {{ __('Send test email') }}
                </button>
            </form>
        </div>
    </div>
@endsection
