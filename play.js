"use strict";

const element = (id) => document.getElementById(id);
const role = location.pathname === "/leda" ? "host" : location.pathname === "/spela" ? "player" : "tv";
const roles = { tv: "TV-spelplan", host: "Spelledare", player: "Spelare" };
const letters = "ABCD";
const categories = ["9", "11", "12", "21", "15", "23", "17", "22", "modern", "party"];
const sections = ["startup", "join", "lobby", "game", "scoreboard", "review"];
const reportStatuses = Object.create(null);
const roomPattern = /^[A-Z0-9]{4,8}$/;
const main = document.querySelector("main");
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
let qrFailed = false;
let qrObjectUrl = "";
let choicesKey = "";
let scoresKey = "";
let seriesKey = "";
let namesKey = "";
let reviewKey = "";
let visibleSection = "";
let finishedRound = "";
let scoreboardUntil = 0;
let vibratedQuestion = "";
let draftAnswer = null;
let draftRevision = 0;
let hostLobbyKey = "";
let hostParticipationTimer;
let hostParticipationRevision = 0;
let hostParticipationWrite = Promise.resolve();
let repeatShortage = null;

document.body.dataset.role = role;
element("role").textContent = roles[role];
element("music-button").hidden = role !== "tv";
element("solo-link").hidden = role !== "tv";
element("host-guide").hidden = role !== "host";

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

function showSection(visible = "") {
    sections.forEach((id) => { element(id).hidden = id !== visible; });
    if (visible !== visibleSection) {
        if (role === "tv") main.scrollTop = 0;
        else if (visible === "join" || visible === "lobby") {
            const form = element(visible === "join" ? "join-form" : "host-form");
            const guide = element("game-help");
            if (form.previousElementSibling !== guide) form.parentNode.insertBefore(guide, form);
        }
    }
    visibleSection = visible;
}

function replaceContents(node, children) {
    node.textContent = "";
    children.forEach((child) => node.appendChild(child));
}

function renderReviewSource(question) {
    const source = element("review-source");
    source.textContent = question.source ? `Fråga från ${question.source}` : "";
    source.hidden = !question.source;
    if (typeof question.sourceUrl !== "string" || !/^https?:\/\//i.test(question.sourceUrl)) return;

    const link = document.createElement("a");
    link.href = question.sourceUrl;
    if (!link.hostname || (link.protocol !== "https:" && link.protocol !== "http:")) return;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.textContent || "Visa frågans källa";
    replaceContents(source, [link]);
    source.hidden = false;
}

function notice(message = "") {
    element("notice").textContent = message;
    element("notice").hidden = !message;
}

function request(path, { method = "GET", body, credential = "", blob = false, timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, path);
        xhr.timeout = timeout;
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
                const detail = data && data.detail;
                let message = "Något gick fel. Försök igen.";
                if (typeof detail === "string") message = detail;
                else if (detail && typeof detail.message === "string") message = detail.message;
                const error = new Error(message);
                error.status = xhr.status;
                if (detail && typeof detail.code === "string") error.code = detail.code;
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
    clearDraft();
    render();
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
            credential: role === "tv" ? "" : token,
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

async function openTvRoom(newRoom = false) {
    await act("setup", async () => {
        if (!newRoom && token) {
            try {
                state = await request(roomPath());
                beginPolling();
                return;
            } catch (error) {
                if (error.status !== 404 && error.status !== 401) throw error;
                token = "";
                storeRoom();
            }
        }
        const result = await request("/api/rooms", { method: "POST" });
        room = result.code;
        token = result.hostToken;
        scoreboardUntil = 0;
        storeRoom();
        state = null;
        clearTimeout(pollTimer);
        resetQr();
        render();
        state = await request(roomPath());
        beginPolling();
    }, true);
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

function startSettingsKey() {
    return JSON.stringify([
        room, (state && state.roundNumber) || 1, element("category").value,
        element("amount").value, element("difficulty").value, selectedFestmixThemes(),
    ]);
}

function selectedFestmixThemes() {
    const themes = [];
    if (element("category").value === "party") {
        const checked = element("festmix-themes").querySelectorAll("input:checked");
        for (let index = 0; index < checked.length; index++) themes.push(checked[index].value);
    }
    return themes;
}

function clearRepeatShortage() {
    if (repeatShortage && element("notice").textContent === repeatShortage.message) notice();
    repeatShortage = null;
    element("allow-repeats").checked = false;
    element("allow-repeats-field").hidden = true;
}

async function roomAction(action, body) {
    const settingsKey = action === "start" ? startSettingsKey() : "";
    await act(action, async () => {
        try {
            state = await request(roomPath(`/${action}`), { method: "POST", body, credential: token });
        } catch (error) {
            if (settingsKey && error.status === 409 && error.code === "new_questions_shortage") {
                if (settingsKey !== startSettingsKey()) return;
                repeatShortage = { settingsKey, category: body.category, message: error.message };
                element("allow-repeats").checked = false;
            }
            throw error;
        }
    }, true);
}

function resetQr() {
    qrKey = "";
    qrPending = "";
    qrFailed = false;
    if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = "";
    const image = element("qr-image");
    image.removeAttribute("src");
    image.hidden = true;
}

async function updateQr() {
    const kind = state.hostReady ? "player" : "host";
    const key = `${room}-${kind}`;
    const image = element("qr-image");
    const status = element("qr-status");
    const retry = element("retry-qr");
    const joinLink = element("join-link");
    if (key !== qrKey) {
        resetQr();
        qrKey = key;
        joinLink.href = `/spela?room=${encodeURIComponent(room)}`;
        joinLink.textContent = `${location.host}/spela`;
        joinLink.hidden = kind === "host";
    }
    if (qrObjectUrl || qrPending === key || qrFailed) return;
    qrPending = key;
    status.hidden = false;
    status.textContent = "Laddar QR-koden…";
    retry.hidden = true;
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
        status.textContent = "QR-koden kunde inte laddas.";
        qrFailed = true;
        retry.hidden = false;
    } finally {
        if (qrPending === key) qrPending = "";
    }
}

function showHostName(enabled) {
    element("host-name-field").hidden = !enabled;
    element("host-name").required = enabled;
}

function hostParticipationFeedback(message = "") {
    const feedback = element("host-participation-feedback");
    feedback.textContent = message;
    feedback.hidden = !message;
}

function scheduleHostParticipation() {
    clearTimeout(hostParticipationTimer);
    const change = ++hostParticipationRevision;
    hostParticipationFeedback();
    if (!state || state.phase !== "lobby") return;
    const path = roomPath("/host-participation");
    const roundNumber = state.roundNumber;
    const hostName = element("host-plays").checked ? element("host-name").value.trim() || null : null;
    const current = () => change === hostParticipationRevision && state && state.phase === "lobby";
    hostParticipationTimer = setTimeout(() => {
        hostParticipationWrite = hostParticipationWrite.then(async () => {
            if (!current()) return;
            try {
                await request(path, { method: "PUT", credential: token, body: { hostName, roundNumber }, timeout: 10000 });
            } catch (error) {
                if (current()) hostParticipationFeedback(error.message);
            }
        });
    }, 250);
}

function renderLobby() {
    showSection("lobby");
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
        const lobbyKey = `${room}-${state.roundNumber}`;
        if (hostLobbyKey !== lobbyKey) {
            hostLobbyKey = lobbyKey;
            ++hostParticipationRevision;
            const name = state.hostPreviewName || "";
            element("host-plays").checked = Boolean(name);
            element("host-name").value = name;
            showHostName(Boolean(name));
            hostParticipationFeedback();
        }
        const start = element("start-game");
        const loading = pending === "start" || state.starting;
        start.textContent = loading ? "Laddar frågor…" : "Starta spelet";
        start.disabled = Boolean(pending) || Boolean(loading);
        element("allow-repeats-field").hidden = !repeatShortage;
        element("allow-repeats").disabled = start.disabled;
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

function choiceCard(answer, index, tag) {
    const option = document.createElement(tag);
    const letter = document.createElement("span");
    letter.className = "choice-letter";
    letter.textContent = letters[index];
    option.className = "choice";
    option.appendChild(letter);
    if (answer !== null) {
        const text = document.createElement("span");
        text.textContent = answer;
        option.appendChild(text);
    }
    return option;
}

function canChooseAnswer() {
    return state && role !== "tv" && state.phase === "question" && state.canAnswer && state.deadline > Date.now() / 1000;
}

function clearDraft() {
    draftAnswer = null;
    draftRevision = 0;
}

function acceptDraft(questionId, saved) {
    if (!saved || (draftAnswer && saved.revision < draftAnswer.revision)) return;
    draftRevision = Math.max(draftRevision, saved.revision);
    draftAnswer = { questionId, choice: saved.choice, revision: saved.revision, saving: "saved" };
}

async function saveDraft(draft) {
    const { questionId, choice, revision } = draft;
    let update;
    try {
        update = await request(roomPath("/draft"), {
            method: "POST",
            body: { questionId, choice, revision },
            credential: token,
            timeout: 7000,
        });
    } catch {
        // A later poll can still recover a draft after a lost response.
    }
    if (draftAnswer !== draft || !canChooseAnswer() || state.question.id !== questionId) return;
    const sameQuestion = update && update.question && update.question.id === questionId;
    // Give the poll responsibility for revealing the closure or an already locked answer.
    if (sameQuestion && (update.phase === "closed" || update.yourChoice !== null)) return;
    const saved = sameQuestion && update.yourDraft;
    if (saved && saved.revision >= revision) acceptDraft(questionId, saved);
    else draft.saving = "failed";
    renderChoices(state.question);
    renderAnswerNote();
}

function chooseAnswer(questionId, choice) {
    if (pending || !canChooseAnswer() || state.question.id !== questionId) return;
    if (draftAnswer && draftAnswer.questionId === questionId && draftAnswer.choice === choice) {
        roomAction("answer", { questionId, choice });
    } else {
        const revision = Math.max(1, Date.now(), draftRevision + 1);
        const canSave = Number.isSafeInteger(revision);
        draftAnswer = { questionId, choice, revision, saving: canSave ? "pending" : "failed" };
        if (canSave) {
            draftRevision = revision;
            saveDraft(draftAnswer);
        }
        renderChoices(state.question);
        renderAnswerNote();
    }
}

function renderChoices(question) {
    const key = question.id + JSON.stringify(question.choices);
    const choices = element("choices");
    const tv = role === "tv";
    const available = canChooseAnswer();
    if (draftAnswer && draftAnswer.questionId !== question.id) clearDraft();
    if (!available) draftAnswer = null;
    if (available) acceptDraft(question.id, state.yourDraft);
    choices.hidden = role === "host" && !state.canAnswer && state.yourChoice === null;
    if (key !== choicesKey) {
        if (tv) main.scrollTop = 0;
        choicesKey = key;
        replaceContents(choices, question.choices.map((answer, index) => {
            const option = choiceCard(tv ? answer : null, index, tv ? "div" : "button");
            if (!tv) {
                option.type = "button";
                option.setAttribute("aria-label", `Svar ${letters[index]}`);
                option.addEventListener("click", () => chooseAnswer(question.id, index));
            }
            return option;
        }));
    }
    [...choices.children].forEach((option, index) => {
        const selected = !tv && state.yourChoice === index;
        const draft = !tv && draftAnswer && draftAnswer.choice === index;
        option.classList.toggle("selected", selected);
        option.classList.toggle("draft", Boolean(draft));
        if (!tv) {
            option.disabled = Boolean(pending) || !available;
            option.setAttribute("aria-pressed", String(Boolean(selected || draft)));
        }
    });
}

function renderAnswerNote() {
    const answerNote = element("answer-note");
    let note = "";
    if (state.phase === "closed") {
        note = role !== "tv" && state.yourChoice !== null
            ? `Frågan är stängd. Ditt svar är ${letters[state.yourChoice]}.`
            : "Frågan är stängd.";
    } else if (role !== "tv") {
        if (state.yourChoice !== null) note = "Svaret är låst.";
        else if (pending === "answer") note = "Låser svaret…";
        else if (draftAnswer) {
            const letter = letters[draftAnswer.choice];
            if (draftAnswer.saving === "pending") note = `Sparar valet ${letter}…`;
            else if (draftAnswer.saving === "failed") note = `Val ${letter} kunde inte sparas. Tryck igen på ${letter} för att låsa nu.`;
            else note = `Val ${letter} räknas när tiden går ut. Tryck igen på ${letter} för att låsa nu.`;
        } else if (state.canAnswer) {
            note = canChooseAnswer()
                ? "Markerat svar räknas när tiden går ut. Tryck två gånger på samma bokstav för att låsa direkt."
                : "Svarstiden är slut.";
        }
    }
    answerNote.hidden = !note;
    if (answerNote.textContent !== note) answerNote.textContent = note;
}

function renderGame() {
    const { question, current, total, answered, players, phase } = state;
    const closed = phase === "closed";
    showSection("game");
    const round = element("round");
    round.hidden = role === "player";
    round.textContent = `Fråga ${current} av ${total}`;
    const count = element("answer-count");
    count.hidden = role === "player";
    count.textContent = `${answered} av ${players.length} har svarat`;
    const heading = element("question");
    heading.hidden = role !== "tv";
    heading.textContent = role === "tv" ? question.text : "";
    element("host-actions").hidden = role !== "host" || !closed;
    element("next").disabled = Boolean(pending);
    element("next").textContent = current === total ? "Visa slutresultat" : "Nästa fråga";
    renderChoices(question);
    renderAnswerNote();
    updateTimer();
}

function renderScores() {
    showSection("scoreboard");
    element("score-round").textContent = `Omgång ${state.roundNumber || 1}`;
    const newGame = element("new-game");
    const openReview = element("open-review");
    const newRound = element("new-round");
    newGame.hidden = role !== "tv";
    newGame.disabled = Boolean(pending);
    openReview.hidden = role !== "host";
    openReview.disabled = Boolean(pending);
    newRound.hidden = role !== "host";
    newRound.disabled = Boolean(pending);
    renderSeries();
    const ranked = state.players;
    const key = JSON.stringify(ranked);
    if (key === scoresKey) return;
    scoresKey = key;
    const leaders = ranked.filter((player) => player.score === ranked[0].score);
    const winner = element("winner");
    winner.hidden = !leaders.length;
    winner.classList.toggle("winner", leaders.length === 1);
    if (leaders.length === 1) winner.textContent = `${leaders[0].name} vinner!`;
    else if (leaders.length > 1) winner.textContent = "Delad förstaplats";
    else winner.textContent = "";
    let place = 1;
    replaceContents(element("scores"), ranked.map(({ name, score }, index) => {
        if (index > 0 && score !== ranked[index - 1].score) place = index + 1;
        const item = document.createElement("li");
        item.value = place;
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

function renderSeries() {
    const { series } = state;
    element("series").hidden = !series || !series.rounds;
    if (!series || !series.rounds) return;
    const key = JSON.stringify(series);
    if (key === seriesKey) return;
    seriesKey = key;
    element("series-rounds").textContent = series.rounds === 1 ? "1 spelad omgång" : `${series.rounds} spelade omgångar`;
    replaceContents(element("series-players"), series.players.map(({ name, wins, lastPlace, places }) => {
        const row = document.createElement("tr");
        const player = document.createElement("th");
        player.scope = "row";
        player.textContent = name;
        row.appendChild(player);
        const history = places.map(({ round, place, score }) => `Omgång ${round} · plats ${place} (${score} p)`).join(", ");
        [wins, lastPlace == null ? "–" : lastPlace, history].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        return row;
    }));
}

function renderPersonalResult() {
    const card = element("personal-result");
    const visible = role !== "tv" && state && typeof state.yourPlace === "number";
    card.hidden = !visible;
    if (!visible) return;
    const { yourPlace, yourScore, players } = state;
    const shared = players.filter((player) => player.score === yourScore).length > 1;
    const text = `${shared ? "Delad plats" : "Plats"} ${yourPlace} · ${yourScore} poäng`;
    const value = element("personal-score");
    if (value.textContent !== text) value.textContent = text;
}

function namedChoice(question, choice) {
    return `${letters[choice]} · ${question.choices[choice]}`;
}

function reviewReportTicket() {
    if (role === "tv" || !state || state.phase !== "review" || !state.review) return "";
    const ticket = state.review.question.reportTicket;
    return typeof ticket === "string" ? ticket : "";
}

function renderReviewReport() {
    const ticket = reviewReportTicket();
    const wrapper = element("review-report");
    wrapper.hidden = !ticket;
    if (!ticket) return;
    const status = reportStatuses[state.review.question.id];
    const message = status === "sent" ? "Frågan är rapporterad."
        : status === "failed" ? "Rapporten kunde inte skickas. Försök igen."
        : status === "sending" ? "Skickar rapporten…" : "";
    element("report-question").disabled = status === "sent" || status === "sending";
    const statusLine = element("report-status");
    if (statusLine.textContent !== message) statusLine.textContent = message;
    statusLine.hidden = !message;
}

async function reportReviewQuestion() {
    const ticket = reviewReportTicket();
    if (!ticket) return;
    const { id } = state.review.question;
    if (reportStatuses[id] === "sent" || reportStatuses[id] === "sending") return;
    reportStatuses[id] = "sending";
    renderReviewReport();
    try {
        await request("/api/question-reports", { method: "POST", body: { ticket } });
        reportStatuses[id] = "sent";
    } catch {
        reportStatuses[id] = "failed";
    }
    renderReviewReport();
}

function renderReview() {
    showSection("review");
    const { current, total, question, answers } = state.review;
    element("review-actions").hidden = role !== "host";
    element("review-prev").disabled = current <= 1 || Boolean(pending);
    element("review-next").disabled = current >= total || Boolean(pending);
    element("new-round-review").hidden = role !== "host";
    element("new-round-review").disabled = Boolean(pending);
    element("restart-review").hidden = role !== "tv";
    element("restart-review").disabled = Boolean(pending);
    renderReviewReport();
    if (reviewKey === question.id) return;
    reviewKey = question.id;
    element("review-round").textContent = `Fråga ${current} av ${total}`;
    element("review-question").textContent = question.text;
    element("review-correct").textContent = `Rätt svar är ${namedChoice(question, question.correctChoice)}`;
    renderReviewSource(question);
    replaceContents(element("review-choices"), question.choices.map((answer, index) => {
        const option = choiceCard(answer, index, "div");
        option.classList.toggle("correct", index === question.correctChoice);
        return option;
    }));
    replaceContents(element("review-answers"), answers.map(({ name, choice }) => {
        const row = document.createElement("tr");
        const player = document.createElement("th");
        player.scope = "row";
        player.textContent = name;
        const answer = document.createElement("td");
        answer.className = "review-picked";
        answer.textContent = choice === null ? "Inget svar" : namedChoice(question, choice);
        answer.classList.toggle("correct", choice === question.correctChoice);
        row.appendChild(player);
        row.appendChild(answer);
        return row;
    }));
    if (role === "tv") main.scrollTop = 0;
}

function updateTimer() {
    const timer = element("timer");
    timer.hidden = !state || state.phase !== "question" || !state.deadline;
    if (timer.hidden) return;
    const remaining = Math.max(0, Math.ceil(state.deadline - Date.now() / 1000));
    timer.classList.toggle("ending", remaining <= 5);
    const label = `${remaining} s kvar`;
    if (timer.textContent !== label) {
        timer.textContent = label;
        if (remaining === 0 && role !== "tv" && state.canAnswer) {
            renderChoices(state.question);
            renderAnswerNote();
        }
    }
    if (role !== "tv" && remaining > 0 && remaining <= 5 && state.canAnswer && pending !== "answer"
        && state.question.id !== vibratedQuestion && typeof navigator.vibrate === "function") {
        vibratedQuestion = state.question.id;
        try {
            navigator.vibrate(200);
        } catch {
            // The countdown still highlights the last five seconds on this device.
        }
    }
}

function render() {
    element("fullscreen-button").classList.toggle("fullscreen-compact", Boolean(state && state.phase !== "lobby"));
    renderPersonalResult();
    if (repeatShortage && (!state || state.phase !== "lobby" || repeatShortage.settingsKey !== startSettingsKey())) {
        clearRepeatShortage();
    }
    if (!state || state.phase !== "question") clearDraft();
    if (role === "tv" && qrKey && (!state || state.phase !== "lobby")) resetQr();
    if (!state) {
        if (role === "tv") {
            showSection("startup");
            element("startup-status").hidden = !pending;
            element("retry-room").hidden = Boolean(pending);
        } else if (role === "player" && !token) {
            showSection("join");
            element("join-form").querySelector("button").disabled = Boolean(pending);
        } else {
            showSection();
        }
        return;
    }
    const roundKey = `${room}-${state.roundNumber || 1}`;
    if (state.phase === "lobby") renderLobby();
    else if (state.phase === "finished") {
        if (role === "tv") {
            finishedRound = roundKey;
            scoreboardUntil = 0;
        }
        renderScores();
    } else if (state.phase === "review") {
        if (role === "tv" && finishedRound !== roundKey) {
            // A fast host can open the review between two TV polls.
            finishedRound = roundKey;
            scoreboardUntil = Date.now() + 1800;
        }
        if (role === "tv" && Date.now() < scoreboardUntil) renderScores();
        else renderReview();
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
        openTvRoom();
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

element("retry-room").addEventListener("click", () => openTvRoom());
element("retry-qr").addEventListener("click", () => {
    qrFailed = false;
    updateQr();
});
["cancel-room", "new-game", "restart-review"].forEach((id) => {
    element(id).addEventListener("click", () => openTvRoom(true));
});
element("join-form").addEventListener("submit", joinRoom);
element("host-plays").addEventListener("change", (event) => {
    showHostName(event.target.checked);
    scheduleHostParticipation();
});
element("host-name").addEventListener("input", scheduleHostParticipation);
["category", "amount", "difficulty", "festmix-themes"].forEach((id) => {
    element(id).addEventListener("change", clearRepeatShortage);
});
function updateFestmixThemeVisibility() {
    element("festmix-themes").hidden = element("category").value !== "party";
}
element("category").addEventListener("change", updateFestmixThemeVisibility);
updateFestmixThemeVisibility();
element("host-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = element("category").value;
    const allowRepeats = repeatShortage && repeatShortage.settingsKey === startSettingsKey() && element("allow-repeats").checked;
    let category = selected;
    if (selected === "random") {
        category = allowRepeats ? repeatShortage.category : categories[Math.floor(Math.random() * categories.length)];
    }
    const body = {
        amount: Number(element("amount").value),
        category,
        difficulty: element("difficulty").value,
        seconds: Number(element("seconds").value),
    };
    const themes = selectedFestmixThemes();
    if (themes.length) body.themes = themes;
    if (allowRepeats) body.allowRepeats = true;
    if (element("host-plays").checked) {
        body.hostName = element("host-name").value.trim();
        if (!body.hostName) {
            notice("Skriv ditt namn för att spela som spelledare.");
            return;
        }
    }
    clearTimeout(hostParticipationTimer);
    ++hostParticipationRevision;
    hostParticipationFeedback();
    roomAction("start", body).then(() => {
        if (state && state.phase === "lobby") scheduleHostParticipation();
    });
});
element("next").addEventListener("click", () => roomAction("next"));
element("open-review").addEventListener("click", () => roomAction("review", { questionNumber: 1 }));
element("report-question").addEventListener("click", reportReviewQuestion);
element("new-round").addEventListener("click", () => roomAction("new-round"));
element("new-round-review").addEventListener("click", () => roomAction("new-round"));
element("review-prev").addEventListener("click", () => roomAction("review", { questionNumber: state.review.current - 1 }));
element("review-next").addEventListener("click", () => roomAction("review", { questionNumber: state.review.current + 1 }));

function configureFullscreen() {
    if (role !== "tv") return;
    const screen = document.documentElement;
    const standard = screen.requestFullscreen && document.fullscreenEnabled !== false;
    const enter = standard ? screen.requestFullscreen : screen.webkitRequestFullscreen || screen.webkitRequestFullScreen;
    if (!enter) return;
    const button = element("fullscreen-button");
    const active = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement
        || document.webkitCurrentFullScreenElement || document.webkitIsFullScreen);
    const sync = () => {
        const fullscreen = active();
        document.body.classList.toggle("fullscreen-active", fullscreen);
        button.hidden = fullscreen;
        button.setAttribute("aria-pressed", String(fullscreen));
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    button.addEventListener("click", async () => {
        try {
            if (standard) await enter.call(screen, { navigationUI: "hide" });
            else await enter.call(screen);
        } catch {
            notice("Det gick inte att öppna helskärm.");
        }
        sync();
    });
    sync();
    if (!button.hidden) button.focus();
}

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

configureFullscreen();
init();
element("boot-status").hidden = true;
setInterval(updateTimer, 250);
