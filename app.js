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
    const nextBtn = document.getElementById("nextBtn");

    // Säkerhetscheck
    if (
        !startScreen ||
        !quizScreen ||
        !questionText ||
        !answersDiv ||
        !startBtn ||
        !questionCount ||
        !difficultySelect ||
        !musicBtn ||
        !nextBtn
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

            selectedCategory = btn.dataset.category;
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

    // ================== NÄSTA FRÅGA ==================
    nextBtn.addEventListener("click", () => {
        if (mode !== "quiz") return;

        clearInterval(timer);
        nextBtn.classList.add("hidden");
        nextQuestion(questionText, answersDiv);
    });

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

    const errorMessage = document.getElementById("quizError");
    errorMessage.textContent = "";
    const params = new URLSearchParams({
        amount: questionCount.value,
        category: selectedCategory,
        difficulty: difficultySelect.value
    });

    try {
        const res = await fetch("/quiz?" + params);
        const data = await res.json();
        if (!res.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : "Frågorna kunde inte hämtas.");
        }
        questions = data;
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
        errorMessage.textContent = e.message || "Frågorna kunde inte hämtas. Försök igen.";
        startBtn.disabled = false;
        startBtn.textContent = "Starta quiz";
    }
}

// ================== SHOW QUESTION ==================
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

    answers.forEach((answer, index) => {
        const div = document.createElement("div");
        div.className = "answer";
        div.dataset.choice = answer;
        const label = document.createElement("strong");
        label.textContent = labels[index] + ".";
        div.append(label, " " + answer);
        answersDiv.appendChild(div);
    });

    // VISA NÄSTA-KNAPPEN
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) nextBtn.classList.remove("hidden");

    startTimer();
}

// ================== NEXT QUESTION ==================
function nextQuestion(questionText, answersDiv) {
    const q = questions[currentIndex];

    // find correct letter from rendered answers
    let correctLetter = "";
    const answerEls = document.querySelectorAll(".answer");

    answerEls.forEach(el => {
        if (el.dataset.choice === q.correct_answer) {
            correctLetter =
                el.querySelector("strong")?.textContent.replace(".", "") || "";
        }
    });

    // store result ONCE per question
    results.push({
        question: q.question,
        correct_answer: q.correct_answer,
        correct_letter: correctLetter
    });

    currentIndex++;

    if (currentIndex >= questions.length) {
        showFacit();
        return;
    }

    showQuestion(questionText, answersDiv);
}

// ================== TIMER ==================
function startTimer() {
    clearInterval(timer);

    const timerEl = document.getElementById("timer");
    let time = 30;

    timerEl.textContent = `Tid kvar: ${time}`;

    timer = setInterval(() => {
        time--;
        timerEl.textContent = `Tid kvar: ${time}`;

        if (time <= 0) {
            clearInterval(timer);
            timerEl.textContent = "Tiden är slut – tryck Nästa";
        }
    }, 1000);
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

    const title = document.createElement("span");
    title.className = "facit-title";
    title.textContent = "✅ Facit";
    questionText.replaceChildren(title);
    answersDiv.replaceChildren(...results.map((item, index) => {
        const entry = document.createElement("div");
        entry.className = "facit-item";
        const question = document.createElement("strong");
        question.textContent = (index + 1) + ". " + item.question;
        const answer = document.createElement("div");
        answer.className = "facit-answer";
        const letter = document.createElement("span");
        letter.textContent = item.correct_letter;
        answer.append("Rätt svar: ", letter, " – " + item.correct_answer);
        entry.append(question, answer);
        return entry;
    }));

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

// ================== UTILS ==================
function shuffle(arr) {
    return arr
        .map(v => ({ v, s: Math.random() }))
        .sort((a, b) => a.s - b.s)
        .map(x => x.v);
}