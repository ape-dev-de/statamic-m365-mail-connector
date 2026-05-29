import Settings from './pages/Settings.vue';

Statamic.booting(() => {
    Statamic.$inertia.register('m365-mailer::Settings', Settings);
});
