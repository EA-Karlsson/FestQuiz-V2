# FestQuiz V2

Öppna startsidan på TV:n och skanna den första QR-koden med spelledarens mobil. När spelledaren är ansluten visar TV:n deltagarnas QR-kod. Spelledaren väljer kategori, antal frågor och svårighetsgrad och startar spelet när alla är med. Deltagarna svarar från sina mobiler och ser frågorna och poängen på TV:n. `/solo` öppnar quiz för en person.

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

Kör webbservern med en process. Spelrum och minnet över nyligen visade frågor sparas i processen och nollställs vid omstart.

## Frågekällor

Varje omgång använder flervalsfrågor från källorna nedan. Dubbletter sorteras bort och svarsalternativen blandas. Om det finns för få frågor för vald kategori och svårighetsgrad får spelledaren ett meddelande om att ändra urvalet.

- Open Trivia DB, CC BY-SA 4.0. Frågor och svar kan översättas till svenska. [Källa och licens](https://opentdb.com/api_config.php)
- The Trivia API, CC BY-NC 4.0. Frågor och svar kan översättas till svenska. Sätt `TRIVIA_API_ENABLED=0` vid kommersiell användning. [Källa och licens](https://the-trivia-api.com/docs)
- QuizBase är en valfri källa för frågor och färdiga svarsalternativ från OpenTriviaQA. [QuizBase](https://quizbase.runriva.com/) · [OpenTriviaQA](https://github.com/uberspot/OpenTriviaQA) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- TriviaAPI.games är en valfri källa för omgångar med alla kategorier och blandad svårighetsgrad. Gratisnivån gäller privata, icke-kommersiella projekt. [Användningsvillkor](https://triviaapi.games/terms)
