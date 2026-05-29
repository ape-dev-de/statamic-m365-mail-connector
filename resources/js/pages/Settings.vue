<script setup>
import { Head, router } from '@statamic/cms/inertia';
import { Card, Heading, Text, Button } from '@statamic/cms/ui';

const props = defineProps({
    configured: Boolean,
    connected: Boolean,
    connection: { type: Object, default: null },
    relayUrl: { type: String, default: null },
    tenantId: { type: String, default: null },
    fromAddress: { type: String, default: null },
    isDefaultMailer: Boolean,
    tokenSource: { type: String, default: null },
    tokenTtlDays: { type: Number, default: 730 },
    urls: { type: Object, required: true },
});

const ttlOptions = [
    { days: 0, label: 'Unlimited' },
    { days: 365, label: '1 year' },
    { days: 730, label: '2 years' },
    { days: 1825, label: '5 years' },
];

function connect() {
    window.location.href = props.urls.consent;
}

function sendTest() {
    router.post(props.urls.test);
}

function saveTtl(days) {
    router.post(props.urls.ttl, { token_ttl_days: days });
}
</script>

<template>
    <Head title="Microsoft 365" />

    <div style="max-width:720px;">
        <Heading size="lg" style="margin-bottom:1.5rem;">Microsoft 365 E-Mail</Heading>

        <Card style="margin-bottom:1rem;">
            <div style="display:flex; align-items:center; gap:.5rem; margin-bottom:1rem;">
                <span :style="`display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:${connected ? 'var(--color-green-500,#22a559)' : 'var(--color-gray-400,#9ca3af)'}`"></span>
                <Heading size="sm">{{ connected ? 'Connected' : 'Not connected' }}</Heading>
                <Text v-if="!connected" variant="subtle">— an admin must grant consent once</Text>
            </div>

            <dl style="display:grid; grid-template-columns:160px 1fr; gap:.4rem 1rem; font-size:.875rem; margin:0;">
                <dt><Text variant="subtle">Relay</Text></dt>
                <dd style="margin:0; font-family:monospace;">{{ relayUrl || '—' }}</dd>
                <dt><Text variant="subtle">Tenant</Text></dt>
                <dd style="margin:0; font-family:monospace;">{{ tenantId || connection?.tenant || 'resolved at consent' }}</dd>
                <dt><Text variant="subtle">From / mailbox</Text></dt>
                <dd style="margin:0; font-family:monospace;">{{ fromAddress || '—' }}</dd>
                <dt><Text variant="subtle">Default mailer</Text></dt>
                <dd style="margin:0;">{{ isDefaultMailer ? 'yes' : 'no (set MAIL_MAILER=microsoft-graph)' }}</dd>
            </dl>

            <Text v-if="tokenSource === 'runtime'" variant="subtle" style="display:block; margin-top:.75rem; font-size:.85rem;">
                Token is stored in storage/m365-mailer/ — put that path on a persistent volume, or set M365_RELAY_TOKEN, so it survives redeploys.
            </Text>
        </Card>

        <Card v-if="!configured" style="margin-bottom:1rem;">
            <Text>Set M365_CLIENT_ID and M365_RELAY_URL in the environment before connecting.</Text>
        </Card>

        <Card style="margin-bottom:1rem;">
            <Heading size="sm" style="margin-bottom:.25rem;">Token lifetime</Heading>
            <Text variant="subtle" style="display:block; margin-bottom:.75rem;">
                How long the capability token stays valid. Applies at the next consent. The relay may cap this.
            </Text>
            <div style="display:flex; gap:.5rem;">
                <Button
                    v-for="o in ttlOptions"
                    :key="o.days"
                    :variant="tokenTtlDays === o.days ? 'primary' : 'default'"
                    @click="saveTtl(o.days)"
                >{{ o.label }}</Button>
            </div>
        </Card>

        <div style="display:flex; gap:.75rem; align-items:center;">
            <Button variant="primary" :disabled="!configured" @click="connect">
                {{ connected ? 'Re-grant admin consent' : 'Connect Microsoft 365 (admin consent)' }}
            </Button>
            <Button :disabled="!configured || !connected" @click="sendTest">
                Send test email
            </Button>
        </div>
    </div>
</template>
