"use strict";

const element = (id) => document.getElementById(id);
const role = location.pathname === "/leda" ? "host" : location.pathname === "/spela" ? "player" : "tv";
const roles = { tv: "TV-spelplan", host: "Spelledare", player: "Spelare" };
const letters = "ABCD";
const categories = ["9", "11", "12", "21", "15", "23", "17", "22", "modern"];
const sections = ["welcome", "join", "lobby", "game", "scoreboard"];
const roomPattern = /^[A-Z0-9]{4,8}$/;
let room = readParameter(location.search, "room").trim().toUpperCase();
if (!roomPattern.test(room)) room = "";
let token = "";
let state = null;
let pending = "";
let revision = 0;
let pollTimer;
let pollFailure = false;
let qrKey = "";
let qrPending = "";
let qrRetryAt = 0;
let qrObjectUrl = "";
let choicesKey = "";
let scoresKey = "";
let namesKey = "";

document.body.dataset.role = role;
element("role").textContent = roles[role];
element("music-button").hidden = role !== "tv";
element("solo-link").hidden = role !== "tv";

function storage(key, value) {
    try {
        if (value === undefined) return sessionStorage.getItem(key) || "";
        if (value) sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
    } catch {
        return "";
    }
}

function readParameter(source, name) {
    const pairs = source.slice(1).split("&");
    for (const pair of pairs) {
        const prefix = name + "=";
        if (pair.indexOf(prefix) === 0) {
            try {
                return decodeURIComponent(pair.slice(prefix.length));
            } catch {
                return "";
            }
        }
    }
    return "";
}

function showSections(...visible) {
    sections.forEach((id) => { element(id).hidden = visible.indexOf(id) < 0; });
}

function replaceContents(node, children) {
    node.textContent = "";
    children.forEach((child) => node.appendChild(child));
}

function notice(message = "") {
    element("notice").textContent = message;
    element("notice").hidden = !message;
}

function request(path, { method = "GET", body, credential = "", blob = false } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, path);
        xhr.timeout = 60000;
        if (credential) xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
        if (body) xhr.setRequestHeader("Content-Type", "application/json");
        if (blob) xhr.responseType = "blob";
        xhr.onload = () => {
            const ok = xhr.status >= 200 && xhr.status < 300;
            let data;
            if (!blob) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch {
                    data = null;
                }
            }
            if (ok && (blob || data !== null)) {
                resolve(blob ? xhr.response : data);
            } else {
                const message = data && typeof data.detail === "string" ? data.detail : "Något gick fel. Försök igen.";
                const error = new Error(message);
                error.status = xhr.status;
                reject(error);
            }
        };
        xhr.onerror = xhr.ontimeout = () => reject(new Error("Kontakten med spelet bröts. Försök igen."));
        xhr.send(body ? JSON.stringify(body) : null);
    });
}

function roomPath(action = "") {
    return `/api/rooms/${encodeURIComponent(room)}${action}`;
}

function storeRoom() {
    if (role === "tv") storage("festquiz.tv", room && token ? JSON.stringify({ room, token }) : "");
    else if (room) storage(`festquiz.${role}.${room}`, token);
}

function expireRoom() {
    token = "";
    storeRoom();
    clearTimeout(pollTimer);
    ++revision;
    state = null;
    if (role === "tv") showSections("welcome");
    else if (role === "player") showSections("join");
    else showSections();
    notice("Spelrummet är inte längre aktivt. Öppna ett nytt rum på TV:n.");
}

async function act(name, action, recover = false) {
    if (pending) return;
    pending = name;
    ++revision;
    render();
    notice();
    try {
        await action();
    } catch (error) {
        if (recover && error.status === 404) expireRoom();
        else notice(error.message);
    } finally {
        pending = "";
        ++revision;
        render();
    }
}

function beginPolling() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 950);
}

async function poll() {
    const before = revision;
    if (pending || !room || !token) {
        if (room && token) beginPolling();
        return;
    }
    try {
        const claiming = role === "host" && (!state || !state.hostReady);
        const update = await request(roomPath(claiming ? "/claim" : ""), {
            method: claiming ? "POST" : "GET",
            credential: token,
        });
        if (before !== revision || pending) return;
        state = update;
        if (pollFailure) notice();
        pollFailure = false;
        render();
    } catch (error) {
        if (before !== revision || pending) return;
        if (error.status === 404 || error.status === 401) {
            expireRoom();
            return;
        }
        pollFailure = true;
        notice("Återansluter till spelrummet…");
    } finally {
        if (room && token) beginPolling();
    }
}

async function createRoom() {
    await act("create", async () => {
        const created = await request("/api/rooms", { method: "POST" });
        room = created.code;
        token = created.hostToken;
        storeRoom();
        state = null;
        beginPolling();
        state = await request(roomPath(), { credential: token });
    });
}

async function claimRoom() {
    await act("claim", async () => {
        state = await request(roomPath("/claim"), { method: "POST", credential: token });
        beginPolling();
    }, true);
    if (!state && room && token) beginPolling();
}

async function joinRoom(event) {
    event.preventDefault();
    const code = element("room-input").value.trim().toUpperCase();
    const name = element("player-name").value.trim();
    if (!roomPattern.test(code) || !name) {
        notice("Fyll i rumskoden och ditt namn.");
        return;
    }
    await act("join", async () => {
        room = code;
        const joined = await request(roomPath("/join"), { method: "POST", body: { name } });
        token = joined.playerToken;
        storeRoom();
        history.replaceState(null, "", `/spela?room=${encodeURIComponent(room)}`);
        beginPolling();
        state = await request(roomPath(), { credential: token });
    });
}

async function roomAction(action, body) {
    await act(action, async () => {
        state = await request(roomPath(`/${action}`), { method: "POST", body, credential: token });
    }, true);
}

async function updateQr() {
    const kind = state.hostReady ? "player" : "host";
    const key = `${room}-${kind}`;
    const image = element("qr-image");
    const status = element("qr-status");
    const joinLink = element("join-link");
    if (key !== qrKey) {
        qrKey = key;
        qrRetryAt = 0;
        qrPending = "";
        if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
        qrObjectUrl = "";
        image.removeAttribute("src");
        image.hidden = true;
        status.hidden = false;
        status.textContent = "Laddar QR-koden…";
        joinLink.href = `/spela?room=${encodeURIComponent(room)}`;
        joinLink.textContent = `${location.host}/spela`;
        joinLink.hidden = kind === "host";
    }
    if (qrObjectUrl || qrPending === key || Date.now() < qrRetryAt) return;
    qrPending = key;
    const options = kind === "host" ? { method: "POST", credential: token, blob: true } : { blob: true };
    try {
        const blob = await request(roomPath(`/qr?role=${kind}`), options);
        if (qrKey !== key) return;
        qrObjectUrl = URL.createObjectURL(blob);
        image.src = qrObjectUrl;
        image.hidden = false;
        status.hidden = true;
    } catch {
        if (qrKey !== key) return;
        status.textContent = "QR-koden kunde inte laddas. Försöker igen…";
        qrRetryAt = Date.now() + 4000;
    } finally {
        if (qrPending === key) qrPending = "";
    }
}

function renderLobby() {
    showSections("lobby");
    element("room-lobby").textContent = `Rum ${room}`;
    element("qr-card").hidden = role !== "tv";
    element("waiting-players").hidden = role === "tv" && !state.hostReady;
    element("host-form").hidden = role !== "host";
    element("cancel-room").hidden = role !== "tv";
    element("cancel-room").disabled = Boolean(pending);
    if (role === "tv") {
        element("lobby-title").textContent = state.hostReady ? "Skanna för att spela" : "Skanna för att bli spelledare";
        element("lobby-note").textContent = state.hostReady
            ? "Öppna FestQuiz på mobilen och skriv ditt namn."
            : "Öppna mobilens kamera och rikta den mot QR-koden.";
        updateQr();
    } else if (role === "host") {
        element("lobby-title").textContent = "Ställ in spelet";
        element("lobby-note").textContent = "Deltagarna går med via QR-koden på TV:n.";
        const start = element("start-game");
        const loading = pending === "start" || state.starting;
        start.textContent = loading ? "Laddar frågor…" : "Starta spelet";
        start.disabled = Boolean(pending) || Boolean(loading);
    } else {
        element("lobby-title").textContent = "Du är med!";
        element("lobby-note").textContent = "Spelledaren startar när alla är redo.";
    }
    const names = state.players.map((player) => player.name);
    element("player-count").textContent = names.length === 1 ? "1 spelare ansluten" : `${names.length} spelare anslutna`;
    const key = JSON.stringify(names);
    if (key !== namesKey) {
        namesKey = key;
        replaceContents(element("lobby-names"), names.map((name) => {
            const item = document.createElement("li");
            item.textContent = name;
            return item;
        }));
    }
}

function renderChoices(question) {
    const key = question.id + JSON.stringify(question.choices);
    const choices = element("choices");
    if (key !== choicesKey) {
        choicesKey = key;
        replaceContents(choices, question.choices.map((answer, index) => {
            const option = document.createElement(role === "tv" ? "div" : "button");
            const letter = document.createElement("span");
            letter.className = "choice-letter";
            letter.textContent = letters[index];
            const text = document.createElement("span");
            text.textContent = answer;
            option.className = "choice";
            option.appendChild(letter);
            option.appendChild(text);
            if (role !== "tv") {
                option.type = "button";
                option.addEventListener("click", () => roomAction("answer", { questionId: question.id, choice: index }));
            }
            return option;
        }));
    }
    const result = state.phase === "result";
    [...choices.children].forEach((option, index) => {
        const selected = state.yourChoice === index;
        option.classList.toggle("selected", selected);
        option.classList.toggle("correct", result && question.correctChoice === index);
        option.classList.toggle("incorrect", result && selected && question.correctChoice !== index);
        if (role !== "tv") {
            option.disabled = Boolean(pending) || !state.canAnswer || result;
            option.setAttribute("aria-pressed", String(selected));
        }
    });
}

function renderGame() {
    const { question, current, total, answered, players, yourChoice, phase } = state;
    const result = phase === "result";
    showSections(...(result ? ["game", "scoreboard"] : ["game"]));
    element("round").textContent = `Fråga ${current} av ${total}`;
    element("answer-count").textContent = `${answered} av ${players.length} har svarat`;
    element("question").textContent = question.text;
    const answerNote = element("answer-note");
    let note = "";
    if (result && typeof question.correctChoice === "number") {
        const correct = `${letters[question.correctChoice]} · ${question.choices[question.correctChoice]}`;
        if (yourChoice === question.correctChoice) note = "Rätt svar!";
        else if (yourChoice !== null) note = `Rätt svar var ${correct}.`;
        else note = `Rätt svar: ${correct}.`;
    } else if (yourChoice !== null) {
        note = "Svaret är sparat. Vänta på facit.";
    } else if (pending === "answer") {
        note = "Sparar svaret…";
    }
    answerNote.hidden = !note;
    if (answerNote.textContent !== note) answerNote.textContent = note;
    element("host-actions").hidden = role !== "host";
    element("reveal").hidden = result;
    element("next").hidden = !result;
    element("reveal").disabled = Boolean(pending);
    element("next").disabled = Boolean(pending);
    element("next").textContent = current === total ? "Visa slutresultat" : "Nästa fråga";
    renderChoices(question);
    updateTimer();
    if (result) renderScores();
}

function renderScores() {
    const finished = state.phase === "finished";
    element("score-heading").textContent = finished ? "Slutresultat" : "Poängställning";
    element("new-game").hidden = !finished || role !== "tv";
    element("new-game").disabled = Boolean(pending);
    const ranked = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "sv"));
    const key = JSON.stringify(ranked);
    if (key === scoresKey) return;
    scoresKey = key;
    replaceContents(element("scores"), ranked.map(({ name, score }) => {
        const item = document.createElement("li");
        const row = document.createElement("div");
        const player = document.createElement("span");
        const points = document.createElement("strong");
        player.textContent = name;
        points.textContent = `${score} p`;
        row.appendChild(player);
        row.appendChild(points);
        item.appendChild(row);
        return item;
    }));
}

function updateTimer() {
    const timer = element("timer");
    timer.hidden = !state || state.phase !== "question" || !state.deadline;
    if (timer.hidden) return;
    const remaining = Math.max(0, Math.ceil(state.deadline - Date.now() / 1000));
    timer.classList.toggle("ending", remaining <= 5);
    const label = `${remaining} s kvar`;
    if (timer.textContent !== label) timer.textContent = label;
}

function render() {
    if (!state) {
        if (role === "tv") {
            showSections("welcome");
            element("create").disabled = Boolean(pending);
        } else if (role === "player" && !token) {
            showSections("join");
            element("join-form").querySelector("button").disabled = Boolean(pending);
        } else {
            showSections();
        }
        return;
    }
    if (state.phase === "lobby") renderLobby();
    else if (state.phase === "finished") {
        showSections("scoreboard");
        renderScores();
    } else if (state.question) {
        renderGame();
    }
}

function init() {
    if (role === "tv") {
        try {
            const saved = JSON.parse(storage("festquiz.tv") || "null");
            if (saved && roomPattern.test(saved.room) && saved.token) {
                room = saved.room;
                token = saved.token;
            }
        } catch {
            storage("festquiz.tv", "");
        }
        if (room && token) poll();
    } else if (role === "host") {
        token = readParameter(location.hash, "token") || storage(`festquiz.host.${room}`);
        if (room && token) {
            storeRoom();
            if (location.hash) history.replaceState(null, "", location.pathname + location.search);
            claimRoom();
        } else {
            notice("Skanna spelledarens QR-kod på TV:n för att leda spelet.");
        }
    } else {
        element("room-input").value = room;
        if (room) token = storage(`festquiz.player.${room}`);
        if (token) poll();
    }
    render();
}

element("create").addEventListener("click", createRoom);
element("cancel-room").addEventListener("click", createRoom);
element("new-game").addEventListener("click", createRoom);
element("join-form").addEventListener("submit", joinRoom);
element("host-plays").addEventListener("change", (event) => {
    element("host-name-field").hidden = !event.target.checked;
    element("host-name").required = event.target.checked;
});
element("host-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = element("category").value;
    const body = {
        amount: Number(element("amount").value),
        category: selected === "random" ? categories[Math.floor(Math.random() * categories.length)] : selected,
        difficulty: element("difficulty").value,
    };
    if (element("host-plays").checked) {
        body.hostName = element("host-name").value.trim();
        if (!body.hostName) {
            notice("Skriv ditt namn för att spela som spelledare.");
            return;
        }
    }
    roomAction("start", body);
});
element("reveal").addEventListener("click", () => roomAction("reveal"));
element("next").addEventListener("click", () => roomAction("next"));

let music;
element("music-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
        if (!music) {
            music = new Audio("/static/music.mp3");
            music.loop = true;
        }
        if (music.paused) await music.play();
        else music.pause();
        button.textContent = music.paused ? "Spela musik" : "Pausa musik";
        button.setAttribute("aria-pressed", String(!music.paused));
    } catch {
        notice("Musiken kunde inte starta.");
    }
});

init();
element("boot-status").hidden = true;
setInterval(updateTimer, 250);
