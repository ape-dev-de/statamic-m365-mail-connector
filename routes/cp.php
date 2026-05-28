<?php

use ApeDev\M365Mailer\Http\Controllers\SettingsController;
use Illuminate\Support\Facades\Route;

Route::get('m365-mailer', [SettingsController::class, 'index'])->name('m365-mailer.index');
Route::get('m365-mailer/consent', [SettingsController::class, 'consent'])->name('m365-mailer.consent');
Route::get('m365-mailer/callback', [SettingsController::class, 'callback'])->name('m365-mailer.callback');
Route::post('m365-mailer/mailbox', [SettingsController::class, 'saveMailbox'])->name('m365-mailer.mailbox');
Route::post('m365-mailer/test', [SettingsController::class, 'test'])->name('m365-mailer.test');
