// ================== GLOBAL STATE ==================
let music = new Audio("music.mp3");
music.loop = true;
music.volume = 0.5;

let questions = [];
let currentIndex = 0;
let timer = null;
let selectedCategory = "";

let results = [];     // sparar facitdata
let mode = "quiz";    // quiz | facit

const CATEGORY_IDS = ["9", "11", "12", "21", "15", "23", "17", "22"];
const MODERN_CATEGORIES = ["11", "12", "15", "9", "17"];

// ================== DOM READY ==================
document.addEventListener("DOMContentLoaded", () => {
    const startScreen = document.getElementById("startScreen");
    const quizScreen = document.getElementById("quizScreen");
    const questionText = document.getElementById("questionText");
    const answersDiv = document.getElementById("answers");
    const startBtn = document.getElementById("startBtn");
    const questionCount = document.getElementById("questionCount");
    const difficultySelect = document.getElementById("difficulty");

    const categoryButtons = document.querySelectorAll("#categories button[data-category]");
    const randomBtn = document.getElementById("randomCategory");
    const musicBtn = document.getElementById("musicBtn");


    // Säkerhetscheck
    if (
        !startScreen ||
        !quizScreen ||
        !questionText ||
        !answersDiv ||
        !startBtn ||
        !questionCount ||
        !difficultySelect ||
        !musicBtn
    ) {
        console.error("DOM saknas");
        return;
    }

    // ================== KATEGORIER ==================
    categoryButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            // Rensa alla markeringar
            categoryButtons.forEach(b => {
                b.style.opacity = "0.5";
                b.classList.remove("active");
            });
            randomBtn.style.opacity = "0.5";
            randomBtn.classList.remove("active");

            // Markera vald knapp
            btn.style.opacity = "1";
            btn.classList.add("active");

            // Hantera kategori
            if (btn.dataset.category === "modern") {
                selectedCategory =
                    MODERN_CATEGORIES[Math.floor(Math.random() * MODERN_CATEGORIES.length)];
            } else {
                selectedCategory = btn.dataset.category;
            }
        });
    });

    randomBtn.addEventListener("click", () => {
        const random =
            CATEGORY_IDS[Math.floor(Math.random() * CATEGORY_IDS.length)];
        selectedCategory = random;

        categoryButtons.forEach(b => {
            b.style.opacity = b.dataset.category === random ? "1" : "0.5";
            b.classList.toggle("active", b.dataset.category === random);
        });

        randomBtn.style.opacity = "1";
        randomBtn.classList.add("active");
    });

    // ================== START ==================
    startBtn.addEventListener("click", () =>
        startQuiz(
            startScreen,
            quizScreen,
            questionText,
            answersDiv,
            startBtn,
            questionCount,
            difficultySelect
        )
    );

    // ================== MUSIKKNAPP ==================
    musicBtn.addEventListener("click", () => {
        if (music.paused) {
            music.play();
            musicBtn.textContent = "⏸️ Pausa musik";
        } else {
            music.pause();
            musicBtn.textContent = "▶️ Starta musik";
        }
    });
});
// ================== START QUIZ ==================
async function startQuiz(
    startScreen,
    quizScreen,
    questionText,
    answersDiv,
    startBtn,
    questionCount,
    difficultySelect
) {
    startBtn.disabled = true;
    startBtn.textContent = "Laddar frågor...";

    const count = questionCount.value;
    const difficulty = difficultySelect.value;

    try {
        const res = await fetch(
            `https://festquiz.onrender.com/quiz?amount=${count}&category=${selectedCategory}&difficulty=${difficulty}`
        );

        if (!res.ok) throw new Error("Fetch failed");

        questions = await res.json();
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new Error("Inga frågor");
        }

        currentIndex = 0;
        results = [];
        mode = "quiz";

        startScreen.classList.add("hidden");
        quizScreen.classList.remove("hidden");

        showQuestion(questionText, answersDiv);
    } catch (e) {
        console.error("STARTQUIZ ERROR:", e);
        startBtn.disabled = false;
        startBtn.textContent = "Starta quiz";
    }
}

// ================== SHOW QUESTION ==================
let lastSentQuestionId = null;

function showQuestion(questionText, answersDiv) {
    clearInterval(timer);

    const progressEl = document.getElementById("progress");
    if (progressEl) {
        progressEl.textContent = `Fråga ${currentIndex + 1} / ${questions.length}`;
    }

    const q = questions[currentIndex];
    if (!q || !q.correct_answer || !Array.isArray(q.incorrect_answers)) {
        nextQuestion(questionText, answersDiv);
        return;
    }

    questionText.textContent = q.question;
    answersDiv.innerHTML = "";

    const answers = shuffle([q.correct_answer, ...q.incorrect_answers]);
    const labels = ["A", "B", "C", "D"];

    let correctLetter = "";

    answers.forEach((a, i) => {
        if (a === q.correct_answer) correctLetter = labels[i];

        const div = document.createElement("div");
        div.className = "answer";
        div.innerHTML = `<strong>${labels[i]}.</strong> ${a}`;
        answersDiv.appendChild(div);
    });

    // --- V2 SYNC: skicka frågan EN GÅNG per fråga ---
    const questionId = `${currentIndex + 1}/${questions.length}`;

    if (
        typeof window.sendQuestionToV2 === "function" &&
        questionId !== lastSentQuestionId
    ) {
        lastSentQuestionId = questionId;

        const selectedDifficulty =
            document.getElementById("difficulty")?.value;

        window.sendQuestionToV2({
            id: questionId,
            question: q.question,
            difficulty: selectedDifficulty || q.difficulty || "medium",
            options: {
                A: answers[0],
                B: answers[1],
                C: answers[2],
                D: answers[3],
            },
            correct_letter: correctLetter
        });
    }

    // 🔁 AUTO-NEXT KOPPLING (DET SOM SAKNADES)
    autoNextTriggered = false;
    watchForAutoNext(questionText, answersDiv);
}

// ================== AUTO NEXT + LADD-SIDA ==================
let autoNextTriggered = false;

function watchForAutoNext(questionText, answersDiv) {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get("room");
    if (!roomCode) return;

    const statusEl = document.getElementById("statusText");

    const interval = setInterval(async () => {
        if (mode !== "quiz" || autoNextTriggered) return;

        try {
            const res = await fetch(`/room/${roomCode}`);
            if (!res.ok) return;

            const data = await res.json();

            if (data.answers_locked === true && data.last_result) {
                autoNextTriggered = true;

                const { right, wrong } = data.last_result;

                // 🧱 VISA LADD-SIDA
                questionText.textContent = "Svar låsta";
                answersDiv.innerHTML = `
                    <div style="font-size:1.5rem; margin-top:20px;">
                        ✅ Rätt: ${right}<br>
                        ❌ Fel: ${wrong}
                    </div>
                    <div style="opacity:.7; margin-top:12px;">
                        Nästa fråga laddas…
                    </div>
                `;

                setTimeout(() => {
                    clearInterval(interval);
                    nextQuestion(questionText, answersDiv);
                }, 2500);
            }
        } catch {
            // tyst
        }
    }, 500);
}

// ================== NEXT QUESTION ==================
function nextQuestion(questionText, answersDiv) {
    const q = questions[currentIndex];

    let correctLetter = "";
    const answerEls = document.querySelectorAll(".answer");

    answerEls.forEach(el => {
        if (el.textContent.includes(q.correct_answer)) {
            correctLetter =
                el.querySelector("strong")?.textContent.replace(".", "") || "";
        }
    });

    results.push({
        question: q.question,
        correct_answer: q.correct_answer,
        correct_letter: correctLetter
    });

    currentIndex++;

    if (currentIndex >= questions.length) {
        const params = new URLSearchParams(window.location.search);
        const roomCode = params.get("room");
        renderV2Final(roomCode);
        return;
    }

    showQuestion(questionText, answersDiv);
}

// ================== FACIT ==================
function showFacit() {
    music.pause();
    music.currentTime = 0;

    const musicBtn = document.getElementById("musicBtn");
    if (musicBtn) musicBtn.textContent = "▶️ Starta musik";

    clearInterval(timer);
    mode = "facit";

    const questionText = document.getElementById("questionText");
    const answersDiv = document.getElementById("answers");

    questionText.innerHTML = `<span class="facit-title">✅ Facit</span>`;

    answersDiv.innerHTML = results
        .map((item, index) => {
            return `
                <div class="facit-item">
                    <strong>${index + 1}. ${item.question}</strong>
                    <div class="facit-answer">
                        Rätt svar: <span>${item.correct_letter}</span> – ${item.correct_answer}
                    </div>
                </div>
            `;
        })
        .join("");

    const btn = document.createElement("button");
    btn.textContent = "Till startsidan";
    btn.className = "restart-btn";

    btn.addEventListener("click", () => {
        results = [];
        questions = [];
        currentIndex = 0;
        mode = "quiz";

        document.getElementById("quizScreen").classList.add("hidden");
        document.getElementById("startScreen").classList.remove("hidden");

        const startBtn = document.getElementById("startBtn");
        startBtn.disabled = false;
        startBtn.textContent = "Starta quiz";
    });

    answersDiv.appendChild(btn);
}

async function renderV2Final(roomCode) {
    clearInterval(timer);
    mode = "facit";

    const questionText = document.getElementById("questionText");
    const answersDiv = document.getElementById("answers");

    questionText.innerHTML = `<span class="facit-title">📊 Slutfacit</span>`;
    answersDiv.innerHTML = `<div style="opacity:.7;">Laddar resultat…</div>`;

    try {
        const res = await fetch(`/room/${roomCode}`);
        if (!res.ok) throw new Error();

        const data = await res.json();
        const results = data.final_results || [];
        const playersObj = data.players || {};

        // ===== FACIT PER FRÅGA =====
        const facitHtml = results.map((r, i) => `
            <div class="facit-item">
                <strong>${i + 1}. ${r.question}</strong>
                <div class="facit-answer">
                    Rätt svar: <span>${r.correct_letter}</span> – ${r.correct_text || ""}
                </div>
                <div style="margin-top:6px;">
                    ✅ Rätt: ${r.right_players.join(", ") || "–"}
                </div>
                <div style="margin-top:4px; opacity:.8;">
                    ❌ Fel: ${r.wrong_players.join(", ") || "–"}
                </div>
            </div>
        `).join("");

        // ===== SCOREBOARD =====
        const scoreboard = Object.values(playersObj)
            .map(p => ({ name: p.name, score: p.score || 0 }))
            .sort((a, b) => b.score - a.score);

        const scoreboardHtml = `
            <div class="facit-item">
                <strong>🏆 Scoreboard</strong>
                <div style="margin-top:10px;">
                    ${scoreboard.map((p, i) => `
                        <div style="margin:6px 0;">
                            ${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"}
                            ${p.name} – <strong>${p.score}</strong>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;

        answersDiv.innerHTML = facitHtml + scoreboardHtml;

        const btn = document.createElement("button");
        btn.textContent = "Till startsidan";
        btn.className = "restart-btn";
        btn.onclick = () => window.location.href = "/static/index.html";

        answersDiv.appendChild(btn);

    } catch {
        answersDiv.innerHTML = "Kunde inte ladda slutfacit.";
    }
}

// ================== UTILS ==================
function shuffle(arr) {
    return arr
        .map(v => ({ v, s: Math.random() }))
        .sort((a, b) => a.s - b.s)
        .map(x => x.v);
}
