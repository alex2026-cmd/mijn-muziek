# YouTube-afspelen: bekende werkende configuratie

Laatst bevestigd: 19 oktober 2026. De eigenaar heeft gemeld dat video's weer afspelen.

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

De oorzaak die de eigenaar zelf heeft gevonden, was op dat moment nog niet beschreven; deze notitie legt daarom de bevestigde configuratie en testafspraken vast zonder een oorzaak te veronderstellen.
