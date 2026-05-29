@extends('statamic::layout')
@section('title', __('Microsoft 365'))

@section('content')
    <div style="max-width: 720px;">
        <h1 style="margin-bottom: 1.5rem;">{{ __('Microsoft 365 E-Mail') }}</h1>

        @if (session('success'))
            <div style="padding: .75rem 1rem; margin-bottom: 1rem; border-radius: .5rem; background: #e7f6ec; color: #1b5e36; border: 1px solid #b7e0c4;">
                {{ session('success') }}
            </div>
        @endif

        @if (session('error'))
            <div style="padding: .75rem 1rem; margin-bottom: 1rem; border-radius: .5rem; background: #fdecec; color: #8a1c1c; border: 1px solid #f3bcbc;">
                {{ session('error') }}
            </div>
        @endif

        <div style="background: #fff; border: 1px solid #e3e8ef; border-radius: .75rem; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem;">
            <div style="display: flex; align-items: center; gap: .5rem; margin-bottom: 1rem;">
                @if ($connected)
                    <span style="display:inline-block; width:.6rem; height:.6rem; border-radius:50%; background:#22a559;"></span>
                    <strong>{{ __('Connected') }}</strong>
                    @if ($connection['consented_at'] ?? null)
                        <span style="color:#6b7280;">— {{ __('admin consent granted') }} {{ \Illuminate\Support\Carbon::parse($connection['consented_at'])->diffForHumans() }}</span>
                    @endif
                @else
                    <span style="display:inline-block; width:.6rem; height:.6rem; border-radius:50%; background:#d1d5db;"></span>
                    <strong>{{ __('Not connected') }}</strong>
                    <span style="color:#6b7280;">— {{ __('an admin must grant consent once') }}</span>
                @endif
            </div>

            <dl style="display: grid; grid-template-columns: 180px 1fr; gap: .4rem 1rem; font-size: .875rem; margin: 0;">
                <dt style="color:#6b7280;">{{ __('Relay') }}</dt>
                <dd style="margin:0; font-family: monospace;">{{ $relayUrl ?: '—' }}</dd>

                <dt style="color:#6b7280;">{{ __('Tenant') }}</dt>
                <dd style="margin:0; font-family: monospace;">
                    @if ($tenantId)
                        {{ $tenantId }}
                    @elseif ($connection['tenant'] ?? null)
                        {{ $connection['tenant'] }} <span style="color:#9ca3af;">({{ __('from consent') }})</span>
                    @else
                        <span style="color:#9ca3af;">{{ __('auto (from sender domain)') }}</span>
                    @endif
                </dd>

                <dt style="color:#6b7280;">{{ __('From / mailbox') }}</dt>
                <dd style="margin:0; font-family: monospace;">{{ $fromAddress ?: '—' }}</dd>

                <dt style="color:#6b7280;">{{ __('Default mailer') }}</dt>
                <dd style="margin:0;">{{ $isDefaultMailer ? __('yes') : __('no (set MAIL_MAILER=microsoft-graph)') }}</dd>
            </dl>
        </div>

        @unless ($configured)
            <div style="padding: .75rem 1rem; margin-bottom: 1.25rem; border-radius: .5rem; background: #fff8e6; color: #7a5b00; border: 1px solid #f3e2a8;">
                {{ __('Set M365_CLIENT_ID and M365_RELAY_URL in the environment before connecting.') }}
            </div>
        @endunless

        <div style="background:#fff; border:1px solid #e3e8ef; border-radius:.75rem; padding:1.25rem 1.5rem; margin-bottom:1.25rem;">
            <h2 style="font-size:1rem; margin:0 0 .25rem;">{{ __('Sender mailbox') }}</h2>
            <p style="color:#6b7280; font-size:.875rem; margin:0 0 .75rem;">
                {{ __('Mailbox the connector sends from. Leave empty for "all / decide per form" — then the From comes from each form or the global mail config.') }}
            </p>
            <form method="POST" action="{{ cp_route('m365-mailer.mailbox') }}" style="display:flex; gap:.5rem; align-items:center; margin:0;">
                @csrf
                <input type="email" name="from_mailbox" value="{{ $fromMailbox }}" placeholder="kontakt@festglanz.de"
                       style="flex:1; padding:.5rem .75rem; border:1px solid #d1d5db; border-radius:.5rem; font-family:monospace;">
                <button type="submit"
                        style="padding:.55rem 1.1rem; border-radius:.5rem; background:#111827; color:#fff; border:none; font-weight:600; cursor:pointer;">
                    {{ __('Save') }}
                </button>
            </form>
        </div>

        <div style="display:flex; gap:.75rem; align-items:center;">
            <a href="{{ cp_route('m365-mailer.consent') }}"
               style="display:inline-block; padding:.55rem 1.1rem; border-radius:.5rem; background:#2563eb; color:#fff; text-decoration:none; font-weight:600; {{ $configured ? '' : 'opacity:.5; pointer-events:none;' }}">
                {{ $connected ? __('Re-grant admin consent') : __('Connect Microsoft 365 (admin consent)') }}
            </a>

            <form method="POST" action="{{ cp_route('m365-mailer.test') }}" style="margin:0;">
                @csrf
                <button type="submit"
                        style="padding:.55rem 1.1rem; border-radius:.5rem; background:#fff; color:#111827; border:1px solid #d1d5db; font-weight:600; cursor:pointer; {{ ($configured && $connected) ? '' : 'opacity:.5; pointer-events:none;' }}">
                    {{ __('Send test email') }}
                </button>
            </form>
        </div>
    </div>
@endsection
