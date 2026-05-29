# AGB & Datenschutz — M365-Mailer-Proxy

> **Hinweis / Disclaimer:** Diese Fassung ist **keine Rechtsberatung**. Vor
> Live-Gang anwaltlich prüfen lassen. Das rechtlich verbindliche Datenschutz-
> Dokument zwischen Anbieter und Kunde ist ein **Auftragsverarbeitungsvertrag
> (AVV) gemäß Art. 28 DSGVO** — diese AGB ersetzen ihn nicht, sondern beschreiben
> den Dienst und verweisen auf ihn.

Stand: 29.05.2026 · Anbieter: Ape Dev GmbH (Geschäftsführer: Alexis Peters),
Sonnenkamp 37, 21717 Fredenbeck · Handelsregister: Amtsgericht Tostedt, HRB 210340
· Kontakt: info@ape-dev.de

## 1. Geltungsbereich & Anbieter

Diese Bedingungen gelten für die Nutzung des „M365-Mailer-Proxy" (nachfolgend
„Dienst"), betrieben von der Ape Dev GmbH (nachfolgend „Anbieter"). Nutzer ist der
Betreiber einer angebundenen Website/Anwendung (nachfolgend „Kunde").

## 2. Leistungsbeschreibung

Der Dienst ist ein **zustandsloser E-Mail-Relay**. Eine autorisierte Kunden-Site
übermittelt einen Sende-Auftrag; der Dienst beschafft ein anwendungsbezogenes
Zugriffstoken bei Microsoft Graph und stellt die E-Mail über das Microsoft-365-
Postfach des Kunden zu. Die Autorisierung erfolgt über ein **kundenspezifisches,
mandantengebundenes Capability-Token**; das verwendete Zertifikat verbleibt
ausschließlich beim Anbieter.

## 3. Datenverarbeitung im Auftrag (Art. 28 DSGVO)

Der Anbieter handelt als **Auftragsverarbeiter**, der Kunde ist
**Verantwortlicher**. Die Verarbeitung erfolgt ausschließlich auf dokumentierte
Weisung des Kunden und ist erst mit Abschluss eines **AVV** verbindlich geregelt.

- **Datenkategorien:** E-Mail-Inhalte (Betreff, Text, Empfänger-, CC-, BCC-,
  Reply-To-Adressen, ggf. Anhänge), Absender-Postfach, Microsoft-Tenant-Kennung,
  technische Metadaten des Capability-Tokens.
- **Zweck:** ausschließlich Entgegennahme und Zustellung der jeweiligen E-Mail.
- **Keine dauerhafte Speicherung von E-Mail-Inhalten:** Inhalte werden nur
  transient im Arbeitsspeicher verarbeitet und nicht persistiert.
- **Protokollierung:** ausschließlich technische Metadaten (Zeitstempel,
  Tenant-Kennung, HTTP-/Zustellstatus) — **keine** E-Mail-Inhalte;
  Aufbewahrung max. 30 Tage, danach Löschung.
- **Betroffenenrechte:** Der Anbieter unterstützt den Kunden bei der Erfüllung
  der Rechte betroffener Personen im Rahmen des AVV.

## 4. Subunternehmer / weitere Verarbeiter

- **Microsoft** (Microsoft 365 / Microsoft Graph) — eigentlicher Mailversand.
- **Hosting/Infrastruktur:** Hetzner Online GmbH, Standorte Nürnberg und
  Falkenstein (Deutschland), georedundant/hochverfügbar.

Der Kunde stimmt dem Einsatz dieser Subunternehmer zu; Änderungen werden
rechtzeitig mitgeteilt (Details im AVV).

## 5. Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

- TLS-verschlüsselte Übertragung.
- Das Microsoft-365-Zertifikat verlässt den Dienst nicht; Kunden-Sites halten
  ausschließlich ein mandantengebundenes Capability-Token mit begrenztem Umfang.
- **Mandantentrennung:** ein Token kann ausschließlich E-Mail für den eigenen
  Tenant auslösen.
- **Widerruf (Revocation):** Tokens sind pro Tenant sofort sperrbar.
- **Missbrauchsschutz:** Ratenbegrenzung pro Tenant; Allowlist der zulässigen
  Rücksprung-Ziele (Schutz vor Open-Redirect/Token-Exfiltration).

## 6. Pflichten des Kunden

Der Kunde stellt sicher, dass der Versand rechtmäßig erfolgt (insb.
Einwilligungen/berechtigtes Interesse, korrekte Absenderangaben, Einhaltung von
UWG/DSGVO), und versendet keine rechtswidrigen Inhalte oder unverlangte Werbung
(Spam). Der Kunde ist für die in seinem Tenant erteilte Berechtigung
verantwortlich und kann sie jederzeit über die Microsoft-Administration entziehen.

## 7. Verfügbarkeit, Support & Haftung

Der Dienst wird **unentgeltlich und nach freiem Ermessen** des Anbieters
bereitgestellt. Es besteht **kein Anspruch** auf Bereitstellung, auf eine bestimmte
Verfügbarkeit, auf zugesicherte Reaktions- oder Wiederherstellungszeiten (**kein
Service-Level-Agreement**) oder auf **Support**. Der Anbieter betreibt den Dienst
mit Sorgfalt auf hochverfügbarer, georedundanter Infrastruktur, übernimmt hierfür
jedoch keine Gewähr und kann den Dienst jederzeit ändern, einschränken oder
einstellen.

Die Haftung des Anbieters ist — soweit gesetzlich zulässig — auf **Vorsatz und
grobe Fahrlässigkeit** beschränkt. Bei der Verletzung wesentlicher Vertragspflichten
(Kardinalpflichten) haftet der Anbieter auch für leichte Fahrlässigkeit, der Höhe
nach begrenzt auf den vertragstypischen, vorhersehbaren Schaden. Die Haftung für
Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie nach
dem Produkthaftungsgesetz bleibt unberührt. Da die Leistung unentgeltlich erfolgt,
gelten zudem die gesetzlichen Haftungsmilderungen für unentgeltliche Leistungen.

## 8. Laufzeit & Beendigung

Die Nutzung endet mit Entzug der Microsoft-Berechtigung (Admin-Consent), Widerruf
des Capability-Tokens oder Kündigung. Nach Beendigung werden etwaige technische
Metadaten gemäß Ziffer 3 gelöscht.

## 9. Schlussbestimmungen

Es gilt das Recht der Bundesrepublik Deutschland. Gerichtsstand ist, soweit
zulässig, Tostedt. Sollten einzelne Bestimmungen unwirksam sein, bleibt die
Wirksamkeit der übrigen unberührt.

---

**Vor Live-Gang anwaltlich prüfen und einen AVV (Art. 28 DSGVO) beilegen.**
