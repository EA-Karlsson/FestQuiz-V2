"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var element = function (id) { return document.getElementById(id); };
var role = location.pathname === "/leda" ? "host" : location.pathname === "/spela" ? "player" : "tv";
var roles = { tv: "TV-spelplan", host: "Spelledare", player: "Spelare" };
var letters = "ABCD";
var categories = ["9", "11", "12", "21", "15", "23", "17", "22", "modern"];
var sections = ["welcome", "join", "lobby", "game", "scoreboard"];
var roomPattern = /^[A-Z0-9]{4,8}$/;
var room = readParameter(location.search, "room").trim().toUpperCase();
if (!roomPattern.test(room))
    room = "";
var token = "";
var state = null;
var pending = "";
var revision = 0;
var pollTimer;
var pollFailure = false;
var qrKey = "";
var qrPending = "";
var qrRetryAt = 0;
var qrObjectUrl = "";
var choicesKey = "";
var scoresKey = "";
var namesKey = "";
document.body.dataset.role = role;
element("role").textContent = roles[role];
element("music-button").hidden = role !== "tv";
element("solo-link").hidden = role !== "tv";
function storage(key, value) {
    try {
        if (value === undefined)
            return sessionStorage.getItem(key) || "";
        if (value)
            sessionStorage.setItem(key, value);
        else
            sessionStorage.removeItem(key);
    }
    catch (_a) {
        return "";
    }
}
function readParameter(source, name) {
    var pairs = source.slice(1).split("&");
    for (var _i = 0, pairs_1 = pairs; _i < pairs_1.length; _i++) {
        var pair = pairs_1[_i];
        var prefix = name + "=";
        if (pair.indexOf(prefix) === 0) {
            try {
                return decodeURIComponent(pair.slice(prefix.length));
            }
            catch (_a) {
                return "";
            }
        }
    }
    return "";
}
function showSections() {
    var visible = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        visible[_i] = arguments[_i];
    }
    sections.forEach(function (id) { element(id).hidden = visible.indexOf(id) < 0; });
}
function replaceContents(node, children) {
    node.textContent = "";
    children.forEach(function (child) { return node.appendChild(child); });
}
function notice(message) {
    if (message === void 0) { message = ""; }
    element("notice").textContent = message;
    element("notice").hidden = !message;
}
function request(path, _a) {
    var _b = _a === void 0 ? {} : _a, _c = _b.method, method = _c === void 0 ? "GET" : _c, body = _b.body, _d = _b.credential, credential = _d === void 0 ? "" : _d, _e = _b.blob, blob = _e === void 0 ? false : _e;
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, path);
        xhr.timeout = 60000;
        if (credential)
            xhr.setRequestHeader("Authorization", "Bearer ".concat(credential));
        if (body)
            xhr.setRequestHeader("Content-Type", "application/json");
        if (blob)
            xhr.responseType = "blob";
        xhr.onload = function () {
            var ok = xhr.status >= 200 && xhr.status < 300;
            var data;
            if (!blob) {
                try {
                    data = JSON.parse(xhr.responseText);
                }
                catch (_a) {
                    data = null;
                }
            }
            if (ok && (blob || data !== null)) {
                resolve(blob ? xhr.response : data);
            }
            else {
                var message = data && typeof data.detail === "string" ? data.detail : "Något gick fel. Försök igen.";
                var error = new Error(message);
                error.status = xhr.status;
                reject(error);
            }
        };
        xhr.onerror = xhr.ontimeout = function () { return reject(new Error("Kontakten med spelet bröts. Försök igen.")); };
        xhr.send(body ? JSON.stringify(body) : null);
    });
}
function roomPath(action) {
    if (action === void 0) { action = ""; }
    return "/api/rooms/".concat(encodeURIComponent(room)).concat(action);
}
function storeRoom() {
    if (role === "tv")
        storage("festquiz.tv", room && token ? JSON.stringify({ room: room, token: token }) : "");
    else if (room)
        storage("festquiz.".concat(role, ".").concat(room), token);
}
function expireRoom() {
    token = "";
    storeRoom();
    clearTimeout(pollTimer);
    ++revision;
    state = null;
    if (role === "tv")
        showSections("welcome");
    else if (role === "player")
        showSections("join");
    else
        showSections();
    notice("Spelrummet är inte längre aktivt. Öppna ett nytt rum på TV:n.");
}
function act(name_1, action_1) {
    return __awaiter(this, arguments, void 0, function (name, action, recover) {
        var error_1;
        if (recover === void 0) { recover = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (pending)
                        return [2 /*return*/];
                    pending = name;
                    ++revision;
                    render();
                    notice();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, action()];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 5];
                case 3:
                    error_1 = _a.sent();
                    if (recover && error_1.status === 404)
                        expireRoom();
                    else
                        notice(error_1.message);
                    return [3 /*break*/, 5];
                case 4:
                    pending = "";
                    ++revision;
                    render();
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function beginPolling() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 950);
}
function poll() {
    return __awaiter(this, void 0, void 0, function () {
        var before, claiming, update, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    before = revision;
                    if (pending || !room || !token) {
                        if (room && token)
                            beginPolling();
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, 4, 5]);
                    claiming = role === "host" && (!state || !state.hostReady);
                    return [4 /*yield*/, request(roomPath(claiming ? "/claim" : ""), {
                            method: claiming ? "POST" : "GET",
                            credential: token,
                        })];
                case 2:
                    update = _a.sent();
                    if (before !== revision || pending)
                        return [2 /*return*/];
                    state = update;
                    if (pollFailure)
                        notice();
                    pollFailure = false;
                    render();
                    return [3 /*break*/, 5];
                case 3:
                    error_2 = _a.sent();
                    if (before !== revision || pending)
                        return [2 /*return*/];
                    if (error_2.status === 404 || error_2.status === 401) {
                        expireRoom();
                        return [2 /*return*/];
                    }
                    pollFailure = true;
                    notice("Återansluter till spelrummet…");
                    return [3 /*break*/, 5];
                case 4:
                    if (room && token)
                        beginPolling();
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function createRoom() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, act("create", function () { return __awaiter(_this, void 0, void 0, function () {
                        var created;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, request("/api/rooms", { method: "POST" })];
                                case 1:
                                    created = _a.sent();
                                    room = created.code;
                                    token = created.hostToken;
                                    storeRoom();
                                    state = null;
                                    beginPolling();
                                    return [4 /*yield*/, request(roomPath(), { credential: token })];
                                case 2:
                                    state = _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function claimRoom() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, act("claim", function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, request(roomPath("/claim"), { method: "POST", credential: token })];
                                case 1:
                                    state = _a.sent();
                                    beginPolling();
                                    return [2 /*return*/];
                            }
                        });
                    }); }, true)];
                case 1:
                    _a.sent();
                    if (!state && room && token)
                        beginPolling();
                    return [2 /*return*/];
            }
        });
    });
}
function joinRoom(event) {
    return __awaiter(this, void 0, void 0, function () {
        var code, name;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    event.preventDefault();
                    code = element("room-input").value.trim().toUpperCase();
                    name = element("player-name").value.trim();
                    if (!roomPattern.test(code) || !name) {
                        notice("Fyll i rumskoden och ditt namn.");
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, act("join", function () { return __awaiter(_this, void 0, void 0, function () {
                            var joined;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        room = code;
                                        return [4 /*yield*/, request(roomPath("/join"), { method: "POST", body: { name: name } })];
                                    case 1:
                                        joined = _a.sent();
                                        token = joined.playerToken;
                                        storeRoom();
                                        history.replaceState(null, "", "/spela?room=".concat(encodeURIComponent(room)));
                                        beginPolling();
                                        return [4 /*yield*/, request(roomPath(), { credential: token })];
                                    case 2:
                                        state = _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function roomAction(action, body) {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, act(action, function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, request(roomPath("/".concat(action)), { method: "POST", body: body, credential: token })];
                                case 1:
                                    state = _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); }, true)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function updateQr() {
    return __awaiter(this, void 0, void 0, function () {
        var kind, key, image, status, joinLink, options, blob, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    kind = state.hostReady ? "player" : "host";
                    key = "".concat(room, "-").concat(kind);
                    image = element("qr-image");
                    status = element("qr-status");
                    joinLink = element("join-link");
                    if (key !== qrKey) {
                        qrKey = key;
                        qrRetryAt = 0;
                        qrPending = "";
                        if (qrObjectUrl)
                            URL.revokeObjectURL(qrObjectUrl);
                        qrObjectUrl = "";
                        image.removeAttribute("src");
                        image.hidden = true;
                        status.hidden = false;
                        status.textContent = "Laddar QR-koden…";
                        joinLink.href = "/spela?room=".concat(encodeURIComponent(room));
                        joinLink.textContent = "".concat(location.host, "/spela");
                        joinLink.hidden = kind === "host";
                    }
                    if (qrObjectUrl || qrPending === key || Date.now() < qrRetryAt)
                        return [2 /*return*/];
                    qrPending = key;
                    options = kind === "host" ? { method: "POST", credential: token, blob: true } : { blob: true };
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, request(roomPath("/qr?role=".concat(kind)), options)];
                case 2:
                    blob = _b.sent();
                    if (qrKey !== key)
                        return [2 /*return*/];
                    qrObjectUrl = URL.createObjectURL(blob);
                    image.src = qrObjectUrl;
                    image.hidden = false;
                    status.hidden = true;
                    return [3 /*break*/, 5];
                case 3:
                    _a = _b.sent();
                    if (qrKey !== key)
                        return [2 /*return*/];
                    status.textContent = "QR-koden kunde inte laddas. Försöker igen…";
                    qrRetryAt = Date.now() + 4000;
                    return [3 /*break*/, 5];
                case 4:
                    if (qrPending === key)
                        qrPending = "";
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function renderLobby() {
    showSections("lobby");
    element("room-lobby").textContent = "Rum ".concat(room);
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
    }
    else if (role === "host") {
        element("lobby-title").textContent = "Ställ in spelet";
        element("lobby-note").textContent = "Deltagarna går med via QR-koden på TV:n.";
        var start = element("start-game");
        var loading = pending === "start" || state.starting;
        start.textContent = loading ? "Laddar frågor…" : "Starta spelet";
        start.disabled = Boolean(pending) || Boolean(loading);
    }
    else {
        element("lobby-title").textContent = "Du är med!";
        element("lobby-note").textContent = "Spelledaren startar när alla är redo.";
    }
    var names = state.players.map(function (player) { return player.name; });
    element("player-count").textContent = names.length === 1 ? "1 spelare ansluten" : "".concat(names.length, " spelare anslutna");
    var key = JSON.stringify(names);
    if (key !== namesKey) {
        namesKey = key;
        replaceContents(element("lobby-names"), names.map(function (name) {
            var item = document.createElement("li");
            item.textContent = name;
            return item;
        }));
    }
}
function renderChoices(question) {
    var key = question.id + JSON.stringify(question.choices);
    var choices = element("choices");
    if (key !== choicesKey) {
        choicesKey = key;
        replaceContents(choices, question.choices.map(function (answer, index) {
            var option = document.createElement(role === "tv" ? "div" : "button");
            var letter = document.createElement("span");
            letter.className = "choice-letter";
            letter.textContent = letters[index];
            var text = document.createElement("span");
            text.textContent = answer;
            option.className = "choice";
            option.appendChild(letter);
            option.appendChild(text);
            if (role !== "tv") {
                option.type = "button";
                option.addEventListener("click", function () { return roomAction("answer", { questionId: question.id, choice: index }); });
            }
            return option;
        }));
    }
    var result = state.phase === "result";
    __spreadArray([], choices.children, true).forEach(function (option, index) {
        var selected = state.yourChoice === index;
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
    var question = state.question, current = state.current, total = state.total, answered = state.answered, players = state.players, yourChoice = state.yourChoice, phase = state.phase;
    var result = phase === "result";
    showSections.apply(void 0, (result ? ["game", "scoreboard"] : ["game"]));
    element("round").textContent = "Fr\u00E5ga ".concat(current, " av ").concat(total);
    element("answer-count").textContent = "".concat(answered, " av ").concat(players.length, " har svarat");
    element("question").textContent = question.text;
    var answerNote = element("answer-note");
    var note = "";
    if (result && typeof question.correctChoice === "number") {
        var correct = "".concat(letters[question.correctChoice], " \u00B7 ").concat(question.choices[question.correctChoice]);
        if (yourChoice === question.correctChoice)
            note = "Rätt svar!";
        else if (yourChoice !== null)
            note = "R\u00E4tt svar var ".concat(correct, ".");
        else
            note = "R\u00E4tt svar: ".concat(correct, ".");
    }
    else if (yourChoice !== null) {
        note = "Svaret är sparat. Vänta på facit.";
    }
    else if (pending === "answer") {
        note = "Sparar svaret…";
    }
    answerNote.hidden = !note;
    if (answerNote.textContent !== note)
        answerNote.textContent = note;
    element("host-actions").hidden = role !== "host";
    element("reveal").hidden = result;
    element("next").hidden = !result;
    element("reveal").disabled = Boolean(pending);
    element("next").disabled = Boolean(pending);
    element("next").textContent = current === total ? "Visa slutresultat" : "Nästa fråga";
    renderChoices(question);
    updateTimer();
    if (result)
        renderScores();
}
function renderScores() {
    var finished = state.phase === "finished";
    element("score-heading").textContent = finished ? "Slutresultat" : "Poängställning";
    element("new-game").hidden = !finished || role !== "tv";
    element("new-game").disabled = Boolean(pending);
    var ranked = __spreadArray([], state.players, true).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name, "sv"); });
    var key = JSON.stringify(ranked);
    if (key === scoresKey)
        return;
    scoresKey = key;
    replaceContents(element("scores"), ranked.map(function (_a) {
        var name = _a.name, score = _a.score;
        var item = document.createElement("li");
        var row = document.createElement("div");
        var player = document.createElement("span");
        var points = document.createElement("strong");
        player.textContent = name;
        points.textContent = "".concat(score, " p");
        row.appendChild(player);
        row.appendChild(points);
        item.appendChild(row);
        return item;
    }));
}
function updateTimer() {
    var timer = element("timer");
    timer.hidden = !state || state.phase !== "question" || !state.deadline;
    if (timer.hidden)
        return;
    var remaining = Math.max(0, Math.ceil(state.deadline - Date.now() / 1000));
    timer.classList.toggle("ending", remaining <= 5);
    var label = "".concat(remaining, " s kvar");
    if (timer.textContent !== label)
        timer.textContent = label;
}
function render() {
    if (!state) {
        if (role === "tv") {
            showSections("welcome");
            element("create").disabled = Boolean(pending);
        }
        else if (role === "player" && !token) {
            showSections("join");
            element("join-form").querySelector("button").disabled = Boolean(pending);
        }
        else {
            showSections();
        }
        return;
    }
    if (state.phase === "lobby")
        renderLobby();
    else if (state.phase === "finished") {
        showSections("scoreboard");
        renderScores();
    }
    else if (state.question) {
        renderGame();
    }
}
function init() {
    if (role === "tv") {
        try {
            var saved = JSON.parse(storage("festquiz.tv") || "null");
            if (saved && roomPattern.test(saved.room) && saved.token) {
                room = saved.room;
                token = saved.token;
            }
        }
        catch (_a) {
            storage("festquiz.tv", "");
        }
        if (room && token)
            poll();
    }
    else if (role === "host") {
        token = readParameter(location.hash, "token") || storage("festquiz.host.".concat(room));
        if (room && token) {
            storeRoom();
            if (location.hash)
                history.replaceState(null, "", location.pathname + location.search);
            claimRoom();
        }
        else {
            notice("Skanna spelledarens QR-kod på TV:n för att leda spelet.");
        }
    }
    else {
        element("room-input").value = room;
        if (room)
            token = storage("festquiz.player.".concat(room));
        if (token)
            poll();
    }
    render();
}
element("create").addEventListener("click", createRoom);
element("cancel-room").addEventListener("click", createRoom);
element("new-game").addEventListener("click", createRoom);
element("join-form").addEventListener("submit", joinRoom);
element("host-plays").addEventListener("change", function (event) {
    element("host-name-field").hidden = !event.target.checked;
    element("host-name").required = event.target.checked;
});
element("host-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var selected = element("category").value;
    var body = {
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
element("reveal").addEventListener("click", function () { return roomAction("reveal"); });
element("next").addEventListener("click", function () { return roomAction("next"); });
var music;
element("music-button").addEventListener("click", function (event) { return __awaiter(void 0, void 0, void 0, function () {
    var button, _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                button = event.currentTarget;
                _b.label = 1;
            case 1:
                _b.trys.push([1, 5, , 6]);
                if (!music) {
                    music = new Audio("/static/music.mp3");
                    music.loop = true;
                }
                if (!music.paused) return [3 /*break*/, 3];
                return [4 /*yield*/, music.play()];
            case 2:
                _b.sent();
                return [3 /*break*/, 4];
            case 3:
                music.pause();
                _b.label = 4;
            case 4:
                button.textContent = music.paused ? "Spela musik" : "Pausa musik";
                button.setAttribute("aria-pressed", String(!music.paused));
                return [3 /*break*/, 6];
            case 5:
                _a = _b.sent();
                notice("Musiken kunde inte starta.");
                return [3 /*break*/, 6];
            case 6: return [2 /*return*/];
        }
    });
}); });
init();
element("boot-status").hidden = true;
setInterval(updateTimer, 250);
