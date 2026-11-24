"use strict";

const element = (id) => document.getElementById(id);
const apiPath = "/api/question-bank";
const reportsPath = "/api/question-reports";
const bankStatus = element("bank-status");
const editStatus = element("bank-edit-status");
const originalQuestion = element("bank-original-question");
const editor = element("bank-editor");
const editInputs = ["bank-question", "bank-correct", "bank-incorrect-1", "bank-incorrect-2", "bank-incorrect-3"].map(element);
const categoryLabels = {
    9: "Allmänbildning",
    11: "Film",
    12: "Musik",
    15: "TV-spel",
    17: "Naturvetenskap",
    21: "Sport",
    22: "Geografi",
    23: "Historia",
    modern: "2000-talet",
    party: "Festmix",
};
const difficultyLabels = { easy: "Lätt", normal: "Medel", medium: "Medel", hard: "Svår" };
const languageLabels = { en: "engelska", fr: "franska", sv: "svenska" };

let adminKey = "";
let questions = [];
let displayedQuery = "";
let activeQuestion = null;
let busy = false;
let reloadNeeded = false;
let pendingRequest = null;

function status(node, message = "", error = false) {
    node.textContent = message;
    node.dataset.error = String(error);
    node.hidden = !message;
}

async function callBank(path, { method = "GET", body, credential = adminKey } = {}) {
    const headers = { Authorization: `Bearer ${credential}` };
    if (body) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    pendingRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            cache: "no-store",
            signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) return result;
        const fallback = response.status === 404 ? "Frågebanken eller frågan finns inte." : "Begäran misslyckades. Försök igen.";
        const error = new Error(typeof result.detail === "string" ? result.detail : fallback);
        error.status = response.status;
        throw error;
    } catch (error) {
        if (error.status) throw error;
        throw new Error("Frågebanken kunde inte nås. Försök igen.");
    } finally {
        clearTimeout(timeout);
        if (pendingRequest === controller) pendingRequest = null;
    }
}

function updateControls() {
    ["bank-login", "bank-key", "bank-query", "bank-search", "bank-lock", "bank-fields", "bank-reload", "bank-reports-reload"].forEach((id) => {
        element(id).disabled = busy;
    });
    element("bank-save").disabled = busy || !activeQuestion || reloadNeeded;
    element("bank-reload").hidden = !reloadNeeded;
    element("bank-results").querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    element("bank-reports-list").querySelectorAll("button").forEach((button) => { button.disabled = busy; });
}

async function perform(action, output = bankStatus) {
    if (busy) return;
    busy = true;
    status(output);
    updateControls();
    try {
        await action();
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            clearAccess();
            status(bankStatus, "Administratörsnyckeln godkändes inte.", true);
        } else {
            status(output, error.message, true);
        }
    } finally {
        busy = false;
        updateControls();
    }
}

function values() {
    return editInputs.map((input) => input.value);
}

function hasChanges() {
    if (!activeQuestion) return false;
    const originalValues = [activeQuestion.question, activeQuestion.correct, ...activeQuestion.incorrect];
    return values().some((value, index) => value !== originalValues[index]);
}

function allowLeavingEditor() {
    return !hasChanges() || window.confirm("Ändringarna är inte sparade. Vill du lämna redigeringen?");
}

function clearAccess() {
    adminKey = "";
    questions = [];
    displayedQuery = "";
    activeQuestion = null;
    reloadNeeded = false;
    element("bank-key").value = "";
    element("bank-query").value = "";
    element("bank-results").textContent = "";
    element("bank-results-summary").textContent = "";
    element("bank-reports").open = false;
    element("bank-reports-list").textContent = "";
    element("bank-reports-summary").textContent = "";
    element("bank-editor-meta").textContent = "";
    originalQuestion.textContent = "";
    element("bank-original-correct").textContent = "";
    element("bank-original-incorrect").textContent = "";
    editInputs.forEach((input) => { input.value = ""; });
    status(editStatus);
    editor.hidden = true;
    element("bank-workspace").hidden = true;
    element("bank-access").hidden = false;
}

function metadata(entry) {
    const category = categoryLabels[entry.category] || entry.category;
    const difficulty = difficultyLabels[entry.difficulty?.toLowerCase()] || entry.difficulty;
    return [entry.source, category, difficulty].filter(Boolean).join(" · ");
}

function updateSelection() {
    element("bank-results").querySelectorAll("button").forEach((button) => {
        if (activeQuestion && button.dataset.questionId === activeQuestion.id) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
    });
}

function renderResults(query) {
    displayedQuery = query;
    element("bank-results-title").textContent = query ? "Sökresultat" : "Senaste frågor";
    let summary = "Inga frågor hittades.";
    if (!query && !questions.length) summary = "Frågor visas här efter att de har hämtats och översatts.";
    else if (questions.length === 50) summary = "Visar 50 frågor. Sök för att hitta fler.";
    else if (questions.length === 1) summary = "1 fråga";
    else if (questions.length) summary = `${questions.length} frågor`;
    element("bank-results-summary").textContent = summary;

    element("bank-results").replaceChildren(...questions.map((entry) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bank-result";
        button.dataset.questionId = entry.id;
        button.textContent = entry.question;
        const caption = document.createElement("small");
        caption.textContent = metadata(entry);
        button.appendChild(caption);
        button.addEventListener("click", () => {
            if (busy || (activeQuestion && entry.id === activeQuestion.id) || !allowLeavingEditor()) return;
            openEditor(entry, true);
        });
        row.appendChild(button);
        return row;
    }));
    updateSelection();
}

function openEditor(entry, focus = false) {
    activeQuestion = entry;
    reloadNeeded = false;
    const original = entry.original;
    element("bank-editor-meta").textContent = metadata(entry);
    const language = languageLabels[entry.language?.toLowerCase()] || entry.language;
    element("bank-original-title").textContent = language ? `Original på ${language}` : "Original";
    originalQuestion.textContent = original.question;
    element("bank-original-correct").textContent = original.correct;
    element("bank-original-incorrect").replaceChildren(...original.incorrect.map((answer) => {
        const item = document.createElement("li");
        item.textContent = answer;
        return item;
    }));
    element("bank-copy").hidden = !navigator.clipboard;
    [entry.question, entry.correct, ...entry.incorrect].forEach((value, index) => { editInputs[index].value = value; });
    editor.hidden = false;
    status(editStatus);
    updateSelection();
    updateControls();
    if (focus) element("bank-editor-title").focus();
}

function refreshEntry(entry) {
    questions = questions.map((old) => old.id === entry.id ? entry : old);
    renderResults(displayedQuery);
    openEditor(entry);
}

async function loadQuestions(query, credential) {
    const path = query ? `${apiPath}?q=${encodeURIComponent(query)}` : apiPath;
    const result = await callBank(path, { credential });
    if (!Array.isArray(result.questions)) throw new Error("Frågorna kunde inte läsas in.");
    return result;
}

async function loadReports() {
    const result = await callBank(reportsPath);
    if (!Array.isArray(result.reports)) throw new Error("Rapporterna kunde inte läsas in.");
    const reports = result.reports;
    element("bank-reports-summary").textContent = reports.length
        ? `${reports.length} öppna rapporter`
        : "Inga öppna rapporter.";
    element("bank-reports-list").replaceChildren(...reports.map((report) => {
        const item = document.createElement("li");
        const prompt = document.createElement("strong");
        prompt.textContent = report.question;
        const answer = document.createElement("p");
        answer.textContent = `Sparat facit: ${report.correct} · ${report.source}`;
        const alternatives = document.createElement("p");
        alternatives.textContent = report.incorrect.join(" · ");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "utility";
        open.textContent = "Öppna frågan";
        open.addEventListener("click", () => {
            if (busy || !allowLeavingEditor()) return;
            perform(async () => {
                const found = await loadQuestions(report.question_key, adminKey);
                if (!found.questions.length) throw new Error("Den rapporterade frågan finns ännu inte i frågebanken.");
                questions = found.questions;
                element("bank-query").value = report.question_key;
                const matchingSource = questions.filter((entry) => entry.source === report.source);
                const matchingText = matchingSource.filter(
                    (entry) => entry.question === report.question && entry.correct === report.correct,
                );
                const exact = matchingText.length === 1 ? matchingText[0] :
                    matchingSource.length === 1 ? matchingSource[0] : null;
                activeQuestion = null;
                editor.hidden = true;
                renderResults(report.question_key);
                if (exact) openEditor(exact, true);
                else status(bankStatus, "Välj rätt version bland träffarna.");
            });
        });
        const resolve = document.createElement("button");
        resolve.type = "button";
        resolve.className = "utility";
        resolve.textContent = "Markera som hanterad";
        resolve.addEventListener("click", () => perform(async () => {
            await callBank(`${reportsPath}/${encodeURIComponent(report.id)}/resolve`, { method: "PUT" });
            await loadReports();
        }));
        const actions = document.createElement("div");
        actions.className = "bank-actions";
        actions.append(open, resolve);
        item.append(prompt, answer, alternatives, actions);
        return item;
    }));
}

element("bank-reports").addEventListener("toggle", () => {
    if (adminKey && element("bank-reports").open) perform(loadReports);
});
element("bank-reports-reload").addEventListener("click", () => perform(loadReports));

element("bank-auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const key = element("bank-key").value.trim();
    element("bank-key").value = "";
    if (!key) {
        status(bankStatus, "Ange administratörsnyckeln.", true);
        return;
    }
    perform(async () => {
        const result = await loadQuestions("", key);
        adminKey = key;
        questions = result.questions;
        element("bank-access").hidden = true;
        element("bank-workspace").hidden = false;
        renderResults("");
    }).then(() => {
        if (adminKey) element("bank-query").focus();
        else element("bank-key").focus();
    });
});

element("bank-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = element("bank-query").value.trim();
    perform(async () => {
        const result = await loadQuestions(query, adminKey);
        questions = result.questions;
        renderResults(query);
    });
});

element("bank-lock").addEventListener("click", () => {
    if (busy || !allowLeavingEditor()) return;
    clearAccess();
    status(bankStatus, "Frågebanken är låst.");
    updateControls();
    element("bank-key").focus();
});

element("bank-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !activeQuestion || reloadNeeded) return;
    const [question, correct, ...incorrect] = values().map((value) => value.trim());
    if (!question || !correct || incorrect.some((choice) => !choice)) {
        status(editStatus, "Fyll i frågan och alla fyra svar.", true);
        return;
    }
    const answers = [correct, ...incorrect].map((answer) => answer.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("sv"));
    if (new Set(answers).size !== 4) {
        status(editStatus, "Svaren behöver ha fyra olika texter.", true);
        return;
    }
    const { id, revision } = activeQuestion;
    perform(async () => {
        try {
            const result = await callBank(`${apiPath}/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: { question, correct, incorrect, revision },
            });
            refreshEntry(result.question);
            status(editStatus, "Frågan sparades.");
        } catch (error) {
            if (error.status !== 409) throw error;
            reloadNeeded = true;
            status(editStatus, "Frågan har ändrats sedan du öppnade den. Hämta den senaste versionen innan du sparar.", true);
        }
    }, editStatus);
});

element("bank-reload").addEventListener("click", () => {
    if (busy || !activeQuestion || !allowLeavingEditor()) return;
    const { id } = activeQuestion;
    perform(async () => {
        const result = await loadQuestions(id, adminKey);
        const latest = result.questions.find((entry) => entry.id === id);
        if (!latest) throw new Error("Frågan kunde inte hämtas.");
        refreshEntry(latest);
        status(editStatus, "Senaste versionen har hämtats.");
    }, editStatus);
});

element("bank-copy").addEventListener("click", async () => {
    if (!activeQuestion) return;
    try {
        await navigator.clipboard.writeText(activeQuestion.original.question);
        status(editStatus, "Originalfrågan kopierades.");
    } catch {
        status(editStatus, "Markera originalfrågan för att kopiera den.", true);
    }
});

window.addEventListener("pagehide", () => {
    if (pendingRequest) pendingRequest.abort();
    clearAccess();
    status(bankStatus);
});
