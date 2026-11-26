# FestQuiz V2

Öppna startsidan på TV:n. Skanna QR-koden som visas automatiskt med spelledarens mobil. När spelledaren är ansluten visar TV:n deltagarnas QR-kod. Spelledaren väljer kategori, svårighetsgrad, upp till 30 frågor och 15, 20 eller 30 sekunders svarstid. Standard är 20 sekunder.

**Festmix** blandar knasiga men sanna fakta med film, musik, retroprylar och traditioner. I spelrummet kan du välja ett eller flera teman. Lämna temana tomma för att blanda alla. Spelet ger knasiga frågor förtur när det finns oanvända på vald svårighetsnivå.

Välj **Det låter påhittat** i kategorilistan för tio fasta Festmix-frågor om verkliga men osannolika djur, uppfinningar och händelser. Varje fråga har en förklaring och en direkt källänk i facit.

TV:n visar frågan och alternativen med A, B, C och D. Deltagarna trycker på en bokstav på mobilen för att markera den och trycker igen på samma bokstav för att låsa svaret. Fram till dess kan de byta val. När tiden går ut räknas det senast markerade alternativet automatiskt för den som inte har låst sitt svar. Spelledaren kan gå vidare när tiden har gått ut eller när alla har låst sina svar. Mobiler med stöd för vibration vibrerar kort vid fem sekunder för spelare som ännu inte låst sitt svar.

Efter sista frågan visar TV:n poängtavlan och spelarna ser sin placering och sina poäng på mobilen. Spelledaren öppnar facit från mobilen och bläddrar mellan frågorna. Där visas rätt svar och vad varje deltagare valde. Spelledaren kan välja **Ny omgång** för att spela vidare med samma deltagare. Poängtavlan visar vinster och placeringar för spelrummets omgångar. Endast en ensam förstaplats ger en vinst i statistiken. Vid lika högsta poäng visas en delad förstaplats.

När FestQuiz har en direkt källänk visas den i facit. Frågor från den egna banken kan rapporteras från facit på mobilen. Rapporterna finns under **Rapporterade frågor** i frågebanken.

FestQuiz hoppar över frågor som redan använts i samma spelrum. Om det finns för få nya frågor kan spelledaren ändra inställningarna eller välja **Tillåt tidigare frågor**. Det valet gäller en omgång och de nya frågorna visas först.

Knappen **Spela i helskärm** döljer webbläsarens ram när webbläsaren stöder funktionen. Knappen och pekaren på spelplanen försvinner när helskärmsläget öppnas.

## Köra lokalt

```sh
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

Öppna `http://localhost:8000` på datorn. För att skanna QR-koderna från en annan enhet, öppna sidan med datorns nätverksadress i stället för `localhost` och anslut enheterna till samma nätverk.

Servern skickar `play.compat.js` till webbläsaren för att stödja äldre TV-modeller. När du ändrar `play.js`, bygg om filen med Node.js och uppdatera båda filerna i Git.

```sh
npx --yes --package=typescript@5.9.3 tsc --allowJs --target ES5 --lib ES2017,DOM --outFile play.compat.js play.js
```

## Render

- Byggkommando `pip install -r requirements.txt`
- Startkommando `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Hälsokontroll `GET /health`
- `DEEPL_API_KEY` behövs för att översätta frågor och svar till svenska. `render.yaml` refererar till samma miljövariabel på tjänsten `festquiz` i samma Render-arbetsyta.
- `TRIVIA_API_KEY` är valfri och används bara om du har en API-nyckel från The Trivia API.
- `QUIZBASE_API_KEY` aktiverar QuizBase. [QuizBase Free](https://quizbase.runriva.com/pricing)
- `TRIVIAAPI_GAMES_API_KEY` aktiverar TriviaAPI.games för blandade omgångar. [TriviaAPI.games Free](https://triviaapi.games/pricing)

Lägg de extra nycklar du vill använda som miljövariabler i **Environment** på tjänsten **FestQuiz-V2** och välj **Save and deploy**.

Kör webbservern med en process. Rummens poäng och frågehistorik ligger i minnet under spelkvällen.

## Egen frågebank

FestQuiz sparar användbara frågor som har översatts från Open Trivia DB, The Trivia API, QuizBase (OpenTriviaQA), SciQ, TriviaRoomQA och Festmix-urvalet från OpenQuizzDB. Den sparar originalet och den svenska versionen tillsammans med källan. Festmix-frågorna som är skrivna på svenska kan också redigeras i banken. QuizzAPI och TriviaAPI.games hämtas fortfarande för spelet enligt sina villkor. Frågor från dessa två källor arkiveras inte permanent.

Öppna `/fragabank` och ange lösenordet i `QUESTION_BANK_ADMIN_KEY` för att söka och rätta sparade frågor. Du kan till exempel behålla ett filmcitat ordagrant och ha resten av frågan på svenska. FestQuiz använder rättelsen när den väljer frågan igen. En pågående omgång behåller frågan som den såg ut när omgången startades.

- Lokalt sparas banken i `data/question-bank.sqlite3`. Ange `QUESTION_BANK_PATH` för att spara på en annan plats. Sätt `QUESTION_BANK_ADMIN_KEY` till ett lösenord med minst 24 ASCII-tecken för att öppna redigeraren.
- På Render, lägg till `QUESTION_BANK_DATABASE_URL` och `QUESTION_BANK_ADMIN_KEY` under **Environment**. Använd en PostgreSQL-adress från en beständig databas, till exempel den poolade adressen från ett [Neon-projekt](https://neon.com/docs/connect/connect-from-any-app). Den vanliga filytan på Render återställs vid omstart, så FestQuiz väntar med att aktivera frågebanken tills lagring har konfigurerats där.

## Frågekällor

Varje omgång använder flervalsfrågor från källorna nedan. Dubbletter sorteras bort och svarsalternativen blandas. Om det finns för få frågor för vald kategori och svårighetsgrad får spelledaren ett meddelande om att ändra urvalet.

- Open Trivia DB, CC BY-SA 4.0. Frågor och svar kan översättas till svenska. [Källa och licens](https://opentdb.com/api_config.php)
- The Trivia API, CC BY-NC 4.0. Frågor och svar kan översättas till svenska. Sätt `TRIVIA_API_ENABLED=0` vid kommersiell användning. [Källa och licens](https://the-trivia-api.com/docs)
- QuizBase är en valfri källa för frågor och färdiga svarsalternativ från OpenTriviaQA. [QuizBase](https://quizbase.runriva.com/) · [OpenTriviaQA](https://github.com/uberspot/OpenTriviaQA) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- TriviaAPI.games är en valfri källa för omgångar med alla kategorier och blandad svårighetsgrad. Gratisnivån gäller privata, icke-kommersiella projekt. [Användningsvillkor](https://triviaapi.games/terms)
- Quiz API v2 av Jonathan Moreschi används med ett granskat urval av internationella och nordiska frågor. QuizzAPI-frågorna översätts från franska. [Quiz API v2 - Jonathan Moreschi](https://quizzapi.jomoreschi.fr/) · [Användningsvillkor](https://github.com/Eromnoj/quizzAPIv2/blob/main/TERMS.md)
- SciQ från Allen Institute for AI ger ett urval av naturvetenskapliga flervalsfrågor i blandad svårighetsgrad. [SciQ](https://huggingface.co/datasets/allenai/sciq) · [CC BY-NC 3.0](https://creativecommons.org/licenses/by-nc/3.0/)
- TriviaRoomQA av Mosolova och Seddah bygger på frågor från OpenQuizzDB. FestQuiz använder ett granskat urval ur den engelska frågebanken. [TriviaRoomQA](https://github.com/anya-bel/triviaroomqa) · [OpenQuizzDB](https://www.openquizzdb.org/) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Festmix innehåller granskade frågor av Philippe Bresoux, Catherine De Smeytere och Corentin Declercq från OpenQuizzDB. De franska originalen och översättningarna har licensen CC BY-SA 4.0. Festmix innehåller också ett sparat, granskat urval från The Trivia API (CC BY-NC 4.0) och svenska frågor med en faktakälla per fråga. [OpenQuizzDB:s quizpaket](https://www.openquizzdb.org/listing/) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) · [Franska original och källor](festmix_openquizzdb.json) · [Engelska original och källor](festmix_the_trivia_api.json) · [Svenska frågor och källor](festmix_swedish.json)
