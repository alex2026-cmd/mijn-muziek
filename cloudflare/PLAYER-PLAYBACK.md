# YouTube-afspelen: bekende werkende configuratie

Laatst bevestigd: 19 oktober 2026. De video's speelden weer af nadat de spelerimplementatie was hersteld.

## Oorzaak en oplossing

De hoofdspeler maakte eerst zelf een iframe en gaf dat daarna aan de YouTube IFrame API. De eerder gekozen privacyhost `youtube-nocookie.com` hielp niet; alleen teruggaan naar `youtube.com` loste het probleem nog niet op. De oplossing was de API zelf het iframe te laten maken vanuit `div#youtubeMount`. Daarna werkte de speler weer.

## Configuratie in `cloudflare/index.html`

- Gebruik de YouTube IFrame Player API via `https://www.youtube.com/iframe_api`.
- Maak de speler met `new YT.Player('youtubeMount', ...)`, waarbij `youtubeMount` een `div` is. De API maakt de YouTube-iframe.
- Geef `origin: location.origin` mee.
- Geef de iframe na `onReady` toestemming voor autoplay en stel `strict-origin-when-cross-origin` in als referrerbeleid.
- Houd deze hoofdspeler op de standaard YouTube-host. Verander de host of de initialisatie niet zonder een echte afspeeltest.
- Behoud de bestaande foutafhandeling en de knop om een video rechtstreeks op YouTube te openen wanneer YouTube insluiten weigert.

## Afspraken voor toekomstige wijzigingen

1. Test in de gepubliceerde app met een bestaand nummer uit de eigen bibliotheek.
2. Bevestig dat beeld of geluid echt start en dat de afspeeltijd minstens enkele seconden oploopt. Alleen een titel, thumbnail of videoduur laden is geen geslaagde afspeeltest.
3. Test daarna één keer vorige/volgende en automatische overgang.
4. Een laadscherm of YouTube-melding “Log in om te bevestigen dat je geen bot bent” is een YouTube-blokkade. Dit mag niet als een geslaagde app-test worden beschouwd en mag niet met code worden omzeild.
5. Foutcode 101/150 betekent volgens YouTube dat de video niet in een ingesloten speler mag worden afgespeeld; foutcode 153 wijst op ontbrekende HTTP Referer/API-clientidentificatie. Controleer de feitelijke code voordat je de melding aanpast.
6. Verander de player-host, de iframe-opzet of referrerinstellingen pas nadat een echte afspeeltest op het doelapparaat slaagt. Als de test faalt, herstel de laatst bevestigde configuratie voordat je andere wijzigingen publiceert.

## Vastgelegde commits

- Speler terug naar de IFrame API met een `div`: [e221372](https://github.com/alex2026-cmd/mijn-muziek/commit/e221372b3adb72ebf1385ae43789da23d05d2f0c)
- Foutmelding verduidelijkt en directe YouTube-fallback toegevoegd: [d5eabe3](https://github.com/alex2026-cmd/mijn-muziek/commit/d5eabe33a00024748788ac6dd1a2654c502e938b)

Deze oorzaak en oplossing zijn vastgesteld tijdens de technische analyse en daarna door de eigenaar bevestigd als werkend.
