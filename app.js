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
        renderScoreboard(roomCode);
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
    answersDiv.innerHTML = `<div style="opacity:.7;">Laddar facit…</div>`;

    try {
        const res = await fetch(`/room/${roomCode}`);
        if (!res.ok) throw new Error();

        const data = await res.json();
        const results = data.final_results || [];

        // 🧱 FACIT-GRID (scroll + auto-fit)
        answersDiv.style.display = "grid";
        answersDiv.style.gridTemplateColumns = "repeat(auto-fit, minmax(320px, 1fr))";
        answersDiv.style.gap = "16px";
        answersDiv.style.alignItems = "start";
        answersDiv.style.maxHeight = "70vh";
        answersDiv.style.overflowY = "auto";
        answersDiv.style.paddingRight = "6px";

        const formatPlayerLine = (p) => {
            if (!p) return "–";
            const name = p.name || "–";
            const letter = p.answer_letter ? p.answer_letter : "(inget svar)";
            const text = p.answer_letter ? (p.answer_text || "") : "";
            return `${name} – ${letter}${text ? " – " + text : ""}`;
        };

        const buildListHtml = (arr, emptyText) => {
            if (!Array.isArray(arr) || arr.length === 0) return emptyText;
            return arr
                .map(p => `<div style="margin-top:4px;">${formatPlayerLine(p)}</div>`)
                .join("");
        };

        answersDiv.innerHTML = results.map((r, i) => {
            const rightHtml = buildListHtml(r.right_players, "–");
            const wrongHtml = buildListHtml(r.wrong_players, "–");

            return `
                <div class="facit-item">
                    <div style="opacity:.7; font-size:0.85rem; margin-bottom:4px;">
                        ${r.category || "Kategori okänd"}
                    </div>

                    <strong>${i + 1}. ${r.question}</strong>

                    <div class="facit-answer" style="margin-top:8px;">
                        Rätt svar:
                        <span>${r.correct_letter}</span>
                        – ${r.correct_text || ""}
                    </div>

                    <div style="margin-top:10px; font-size:0.95rem;">
                        <strong>✅ Rätt:</strong>
                        ${rightHtml}
                    </div>

                    <div style="margin-top:10px; font-size:0.95rem;">
                        <strong>❌ Fel:</strong>
                        ${wrongHtml}
                    </div>
                </div>
            `;
        }).join("");

        const btn = document.createElement("button");
        btn.textContent = "Till startsidan";
        btn.className = "restart-btn";
        btn.onclick = () => {
            window.location.href = "/static/index.html";
        };

        const wrapper = document.createElement("div");
        wrapper.style.marginTop = "24px";
        wrapper.style.gridColumn = "1 / -1";
        wrapper.appendChild(btn);

        answersDiv.appendChild(wrapper);

    } catch {
        answersDiv.innerHTML = "Kunde inte ladda slutfacit.";
    }
}

async function renderScoreboard(roomCode) {
    clearInterval(timer);
    mode = "scoreboard";

    const questionText = document.getElementById("questionText");
    const answersDiv = document.getElementById("answers");
    const timerEl = document.getElementById("timer");

    if (timerEl) timerEl.style.display = "none";

    // 🔒 Tvinga centrering av innehållet
    answersDiv.style.display = "flex";
    answersDiv.style.justifyContent = "center";
    answersDiv.style.alignItems = "flex-start";
    answersDiv.style.width = "100%";

    questionText.innerHTML = `<span class="facit-title">🏆 Resultat</span>`;
    answersDiv.innerHTML = `<div style="opacity:.7;">Laddar scoreboard…</div>`;

    try {
        const res = await fetch(`/room/${roomCode}`);
        if (!res.ok) throw new Error();

        const data = await res.json();
        const playersObj = data.players || {};

        const scoreboard = Object.values(playersObj)
            .map(p => ({ name: p.name, score: p.score || 0 }))
            .sort((a, b) => b.score - a.score);

        const winner = scoreboard[0];
        const others = scoreboard.slice(1);

        answersDiv.innerHTML = `
            <div class="facit-item" style="
                padding:32px;
                max-width:700px;
                width:100%;
                text-align:left;
            ">

                <div style="font-size:1.8rem; margin-bottom:20px;">
                    🏆 <strong>Vinnare</strong>
                </div>

                <div style="font-size:2.4rem; margin-bottom:30px;">
                    🥇 <strong>${winner?.name || "–"}</strong>
                    <span style="opacity:.8;">– ${winner?.score || 0} poäng</span>
                </div>

                ${others.length > 0 ? `
                    <div>
                        ${others.map((p, i) => `
                            <div style="margin:14px 0; font-size:1.5rem;">
                                ${i === 0 ? "🥈" : i === 1 ? "🥉" : "•"}
                                <strong>${p.name}</strong> – ${p.score}
                            </div>
                        `).join("")}
                    </div>
                ` : ""}

                <div style="margin-top:28px;">
                    <button
                        onclick="renderV2Final('${roomCode}')"
                        style="
                            font-size:14px;
                            padding:10px 18px;
                            background:#333;
                            color:#fff;
                            border-radius:8px;
                            border:none;
                            cursor:pointer;
                        "
                    >
                        Visa facit
                    </button>
                </div>

            </div>
        `;

    } catch {
        answersDiv.innerHTML = "Kunde inte ladda scoreboard.";
    }
}

// ================== UTILS ==================
function shuffle(arr) {
    return arr
        .map(v => ({ v, s: Math.random() }))
        .sort((a, b) => a.s - b.s)
        .map(x => x.v);
}
