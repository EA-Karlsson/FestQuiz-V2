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
var categories = ["9", "11", "12", "21", "15", "23", "17", "22", "modern", "party"];
var sections = ["startup", "join", "lobby", "game", "scoreboard", "review"];
var reportStatuses = Object.create(null);
var roomPattern = /^[A-Z0-9]{4,8}$/;
var main = document.querySelector("main");
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
var qrFailed = false;
var qrObjectUrl = "";
var choicesKey = "";
var scoresKey = "";
var seriesKey = "";
var namesKey = "";
var reviewKey = "";
var visibleSection = "";
var finishedRound = "";
var scoreboardUntil = 0;
var vibratedQuestion = "";
var draftAnswer = null;
var draftRevision = 0;
var hostLobbyKey = "";
var hostParticipationTimer;
var hostParticipationRevision = 0;
var hostParticipationWrite = Promise.resolve();
var repeatShortage = null;
document.body.dataset.role = role;
element("role").textContent = roles[role];
element("music-button").hidden = role !== "tv";
element("solo-link").hidden = role !== "tv";
element("host-guide").hidden = role !== "host";
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
function showSection(visible) {
    if (visible === void 0) { visible = ""; }
    sections.forEach(function (id) { element(id).hidden = id !== visible; });
    if (visible !== visibleSection) {
        if (role === "tv")
            main.scrollTop = 0;
        else if (visible === "join" || visible === "lobby") {
            var form = element(visible === "join" ? "join-form" : "host-form");
            var guide = element("game-help");
            if (form.previousElementSibling !== guide)
                form.parentNode.insertBefore(guide, form);
        }
    }
    visibleSection = visible;
}
function replaceContents(node, children) {
    node.textContent = "";
    children.forEach(function (child) { return node.appendChild(child); });
}
function renderReviewSource(question) {
    var source = element("review-source");
    source.textContent = question.source ? "Fr\u00E5ga fr\u00E5n ".concat(question.source) : "";
    source.hidden = !question.source;
    if (typeof question.sourceUrl !== "string" || !/^https?:\/\//i.test(question.sourceUrl))
        return;
    var link = document.createElement("a");
    link.href = question.sourceUrl;
    if (!link.hostname || (link.protocol !== "https:" && link.protocol !== "http:"))
        return;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.textContent || "Visa frågans källa";
    replaceContents(source, [link]);
    source.hidden = false;
}
function notice(message) {
    if (message === void 0) { message = ""; }
    element("notice").textContent = message;
    element("notice").hidden = !message;
}
function request(path, _a) {
    var _b = _a === void 0 ? {} : _a, _c = _b.method, method = _c === void 0 ? "GET" : _c, body = _b.body, _d = _b.credential, credential = _d === void 0 ? "" : _d, _e = _b.blob, blob = _e === void 0 ? false : _e, _f = _b.timeout, timeout = _f === void 0 ? 60000 : _f;
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, path);
        xhr.timeout = timeout;
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
                var detail = data && data.detail;
                var message = "Något gick fel. Försök igen.";
                if (typeof detail === "string")
                    message = detail;
                else if (detail && typeof detail.message === "string")
                    message = detail.message;
                var error = new Error(message);
                error.status = xhr.status;
                if (detail && typeof detail.code === "string")
                    error.code = detail.code;
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
    clearDraft();
    render();
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
                            credential: role === "tv" ? "" : token,
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
function openTvRoom() {
    return __awaiter(this, arguments, void 0, function (newRoom) {
        var _this = this;
        if (newRoom === void 0) { newRoom = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, act("setup", function () { return __awaiter(_this, void 0, void 0, function () {
                        var error_3, result;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (!(!newRoom && token)) return [3 /*break*/, 4];
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, request(roomPath())];
                                case 2:
                                    state = _a.sent();
                                    beginPolling();
                                    return [2 /*return*/];
                                case 3:
                                    error_3 = _a.sent();
                                    if (error_3.status !== 404 && error_3.status !== 401)
                                        throw error_3;
                                    token = "";
                                    storeRoom();
                                    return [3 /*break*/, 4];
                                case 4: return [4 /*yield*/, request("/api/rooms", { method: "POST" })];
                                case 5:
                                    result = _a.sent();
                                    room = result.code;
                                    token = result.hostToken;
                                    scoreboardUntil = 0;
                                    storeRoom();
                                    state = null;
                                    clearTimeout(pollTimer);
                                    resetQr();
                                    render();
                                    return [4 /*yield*/, request(roomPath())];
                                case 6:
                                    state = _a.sent();
                                    beginPolling();
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
function startSettingsKey() {
    return JSON.stringify([
        room, (state && state.roundNumber) || 1, element("category").value,
        element("amount").value, element("difficulty").value, selectedFestmixThemes(),
    ]);
}
function selectedFestmixThemes() {
    var themes = [];
    if (element("category").value === "party") {
        var checked = element("festmix-themes").querySelectorAll("input:checked");
        for (var index = 0; index < checked.length; index++)
            themes.push(checked[index].value);
    }
    return themes;
}
function clearRepeatShortage() {
    if (repeatShortage && element("notice").textContent === repeatShortage.message)
        notice();
    repeatShortage = null;
    element("allow-repeats").checked = false;
    element("allow-repeats-field").hidden = true;
}
function roomAction(action, body) {
    return __awaiter(this, void 0, void 0, function () {
        var settingsKey;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    settingsKey = action === "start" ? startSettingsKey() : "";
                    return [4 /*yield*/, act(action, function () { return __awaiter(_this, void 0, void 0, function () {
                            var error_4;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, request(roomPath("/".concat(action)), { method: "POST", body: body, credential: token })];
                                    case 1:
                                        state = _a.sent();
                                        return [3 /*break*/, 3];
                                    case 2:
                                        error_4 = _a.sent();
                                        if (settingsKey && error_4.status === 409 && error_4.code === "new_questions_shortage") {
                                            if (settingsKey !== startSettingsKey())
                                                return [2 /*return*/];
                                            repeatShortage = { settingsKey: settingsKey, category: body.category, message: error_4.message };
                                            element("allow-repeats").checked = false;
                                        }
                                        throw error_4;
                                    case 3: return [2 /*return*/];
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
function resetQr() {
    qrKey = "";
    qrPending = "";
    qrFailed = false;
    if (qrObjectUrl)
        URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = "";
    var image = element("qr-image");
    image.removeAttribute("src");
    image.hidden = true;
}
function updateQr() {
    return __awaiter(this, void 0, void 0, function () {
        var kind, key, image, status, retry, joinLink, options, blob, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    kind = state.hostReady ? "player" : "host";
                    key = "".concat(room, "-").concat(kind);
                    image = element("qr-image");
                    status = element("qr-status");
                    retry = element("retry-qr");
                    joinLink = element("join-link");
                    if (key !== qrKey) {
                        resetQr();
                        qrKey = key;
                        joinLink.href = "/spela?room=".concat(encodeURIComponent(room));
                        joinLink.textContent = "".concat(location.host, "/spela");
                        joinLink.hidden = kind === "host";
                    }
                    if (qrObjectUrl || qrPending === key || qrFailed)
                        return [2 /*return*/];
                    qrPending = key;
                    status.hidden = false;
                    status.textContent = "Laddar QR-koden…";
                    retry.hidden = true;
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
                    status.textContent = "QR-koden kunde inte laddas.";
                    qrFailed = true;
                    retry.hidden = false;
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
function showHostName(enabled) {
    element("host-name-field").hidden = !enabled;
    element("host-name").required = enabled;
}
function hostParticipationFeedback(message) {
    if (message === void 0) { message = ""; }
    var feedback = element("host-participation-feedback");
    feedback.textContent = message;
    feedback.hidden = !message;
}
function scheduleHostParticipation() {
    var _this = this;
    clearTimeout(hostParticipationTimer);
    var change = ++hostParticipationRevision;
    hostParticipationFeedback();
    if (!state || state.phase !== "lobby")
        return;
    var path = roomPath("/host-participation");
    var roundNumber = state.roundNumber;
    var hostName = element("host-plays").checked ? element("host-name").value.trim() || null : null;
    var current = function () { return change === hostParticipationRevision && state && state.phase === "lobby"; };
    hostParticipationTimer = setTimeout(function () {
        hostParticipationWrite = hostParticipationWrite.then(function () { return __awaiter(_this, void 0, void 0, function () {
            var error_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!current())
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, request(path, { method: "PUT", credential: token, body: { hostName: hostName, roundNumber: roundNumber }, timeout: 10000 })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_5 = _a.sent();
                        if (current())
                            hostParticipationFeedback(error_5.message);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); });
    }, 250);
}
function renderLobby() {
    showSection("lobby");
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
        var lobbyKey = "".concat(room, "-").concat(state.roundNumber);
        if (hostLobbyKey !== lobbyKey) {
            hostLobbyKey = lobbyKey;
            ++hostParticipationRevision;
            var name_1 = state.hostPreviewName || "";
            element("host-plays").checked = Boolean(name_1);
            element("host-name").value = name_1;
            showHostName(Boolean(name_1));
            hostParticipationFeedback();
        }
        var start = element("start-game");
        var loading = pending === "start" || state.starting;
        start.textContent = loading ? "Laddar frågor…" : "Starta spelet";
        start.disabled = Boolean(pending) || Boolean(loading);
        element("allow-repeats-field").hidden = !repeatShortage;
        element("allow-repeats").disabled = start.disabled;
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
function choiceCard(answer, index, tag) {
    var option = document.createElement(tag);
    var letter = document.createElement("span");
    letter.className = "choice-letter";
    letter.textContent = letters[index];
    option.className = "choice";
    option.appendChild(letter);
    if (answer !== null) {
        var text = document.createElement("span");
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
    if (!saved || (draftAnswer && saved.revision < draftAnswer.revision))
        return;
    draftRevision = Math.max(draftRevision, saved.revision);
    draftAnswer = { questionId: questionId, choice: saved.choice, revision: saved.revision, saving: "saved" };
}
function saveDraft(draft) {
    return __awaiter(this, void 0, void 0, function () {
        var questionId, choice, revision, update, _a, sameQuestion, saved;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    questionId = draft.questionId, choice = draft.choice, revision = draft.revision;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, request(roomPath("/draft"), {
                            method: "POST",
                            body: { questionId: questionId, choice: choice, revision: revision },
                            credential: token,
                            timeout: 7000,
                        })];
                case 2:
                    update = _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    return [3 /*break*/, 4];
                case 4:
                    if (draftAnswer !== draft || !canChooseAnswer() || state.question.id !== questionId)
                        return [2 /*return*/];
                    sameQuestion = update && update.question && update.question.id === questionId;
                    // Give the poll responsibility for revealing the closure or an already locked answer.
                    if (sameQuestion && (update.phase === "closed" || update.yourChoice !== null))
                        return [2 /*return*/];
                    saved = sameQuestion && update.yourDraft;
                    if (saved && saved.revision >= revision)
                        acceptDraft(questionId, saved);
                    else
                        draft.saving = "failed";
                    renderChoices(state.question);
                    renderAnswerNote();
                    return [2 /*return*/];
            }
        });
    });
}
function chooseAnswer(questionId, choice) {
    if (pending || !canChooseAnswer() || state.question.id !== questionId)
        return;
    if (draftAnswer && draftAnswer.questionId === questionId && draftAnswer.choice === choice) {
        roomAction("answer", { questionId: questionId, choice: choice });
    }
    else {
        var revision_1 = Math.max(1, Date.now(), draftRevision + 1);
        var canSave = Number.isSafeInteger(revision_1);
        draftAnswer = { questionId: questionId, choice: choice, revision: revision_1, saving: canSave ? "pending" : "failed" };
        if (canSave) {
            draftRevision = revision_1;
            saveDraft(draftAnswer);
        }
        renderChoices(state.question);
        renderAnswerNote();
    }
}
function renderChoices(question) {
    var key = question.id + JSON.stringify(question.choices);
    var choices = element("choices");
    var tv = role === "tv";
    var available = canChooseAnswer();
    if (draftAnswer && draftAnswer.questionId !== question.id)
        clearDraft();
    if (!available)
        draftAnswer = null;
    if (available)
        acceptDraft(question.id, state.yourDraft);
    choices.hidden = role === "host" && !state.canAnswer && state.yourChoice === null;
    if (key !== choicesKey) {
        if (tv)
            main.scrollTop = 0;
        choicesKey = key;
        replaceContents(choices, question.choices.map(function (answer, index) {
            var option = choiceCard(tv ? answer : null, index, tv ? "div" : "button");
            if (!tv) {
                option.type = "button";
                option.setAttribute("aria-label", "Svar ".concat(letters[index]));
                option.addEventListener("click", function () { return chooseAnswer(question.id, index); });
            }
            return option;
        }));
    }
    __spreadArray([], choices.children, true).forEach(function (option, index) {
        var selected = !tv && state.yourChoice === index;
        var draft = !tv && draftAnswer && draftAnswer.choice === index;
        option.classList.toggle("selected", selected);
        option.classList.toggle("draft", Boolean(draft));
        if (!tv) {
            option.disabled = Boolean(pending) || !available;
            option.setAttribute("aria-pressed", String(Boolean(selected || draft)));
        }
    });
}
function renderAnswerNote() {
    var answerNote = element("answer-note");
    var note = "";
    if (state.phase === "closed") {
        note = role !== "tv" && state.yourChoice !== null
            ? "Fr\u00E5gan \u00E4r st\u00E4ngd. Ditt svar \u00E4r ".concat(letters[state.yourChoice], ".")
            : "Frågan är stängd.";
    }
    else if (role !== "tv") {
        if (state.yourChoice !== null)
            note = "Svaret är låst.";
        else if (pending === "answer")
            note = "Låser svaret…";
        else if (draftAnswer) {
            var letter = letters[draftAnswer.choice];
            if (draftAnswer.saving === "pending")
                note = "Sparar valet ".concat(letter, "\u2026");
            else if (draftAnswer.saving === "failed")
                note = "Val ".concat(letter, " kunde inte sparas. Tryck igen p\u00E5 ").concat(letter, " f\u00F6r att l\u00E5sa nu.");
            else
                note = "Val ".concat(letter, " r\u00E4knas n\u00E4r tiden g\u00E5r ut. Tryck igen p\u00E5 ").concat(letter, " f\u00F6r att l\u00E5sa nu.");
        }
        else if (state.canAnswer) {
            note = canChooseAnswer()
                ? "Markerat svar räknas när tiden går ut. Tryck två gånger på samma bokstav för att låsa direkt."
                : "Svarstiden är slut.";
        }
    }
    answerNote.hidden = !note;
    if (answerNote.textContent !== note)
        answerNote.textContent = note;
}
function renderGame() {
    var question = state.question, current = state.current, total = state.total, answered = state.answered, players = state.players, phase = state.phase;
    var closed = phase === "closed";
    showSection("game");
    var round = element("round");
    round.hidden = role === "player";
    round.textContent = "Fr\u00E5ga ".concat(current, " av ").concat(total);
    var count = element("answer-count");
    count.hidden = role === "player";
    count.textContent = "".concat(answered, " av ").concat(players.length, " har svarat");
    var heading = element("question");
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
    element("score-round").textContent = "Omg\u00E5ng ".concat(state.roundNumber || 1);
    var newGame = element("new-game");
    var openReview = element("open-review");
    var newRound = element("new-round");
    newGame.hidden = role !== "tv";
    newGame.disabled = Boolean(pending);
    openReview.hidden = role !== "host";
    openReview.disabled = Boolean(pending);
    newRound.hidden = role !== "host";
    newRound.disabled = Boolean(pending);
    renderSeries();
    var ranked = state.players;
    var key = JSON.stringify(ranked);
    if (key === scoresKey)
        return;
    scoresKey = key;
    var leaders = ranked.filter(function (player) { return player.score === ranked[0].score; });
    var winner = element("winner");
    winner.hidden = !leaders.length;
    winner.classList.toggle("winner", leaders.length === 1);
    if (leaders.length === 1)
        winner.textContent = "".concat(leaders[0].name, " vinner!");
    else if (leaders.length > 1)
        winner.textContent = "Delad förstaplats";
    else
        winner.textContent = "";
    var place = 1;
    replaceContents(element("scores"), ranked.map(function (_a, index) {
        var name = _a.name, score = _a.score;
        if (index > 0 && score !== ranked[index - 1].score)
            place = index + 1;
        var item = document.createElement("li");
        item.value = place;
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
function renderSeries() {
    var series = state.series;
    element("series").hidden = !series || !series.rounds;
    if (!series || !series.rounds)
        return;
    var key = JSON.stringify(series);
    if (key === seriesKey)
        return;
    seriesKey = key;
    element("series-rounds").textContent = series.rounds === 1 ? "1 spelad omgång" : "".concat(series.rounds, " spelade omg\u00E5ngar");
    replaceContents(element("series-players"), series.players.map(function (_a) {
        var name = _a.name, wins = _a.wins, lastPlace = _a.lastPlace, places = _a.places;
        var row = document.createElement("tr");
        var player = document.createElement("th");
        player.scope = "row";
        player.textContent = name;
        row.appendChild(player);
        var history = places.map(function (_a) {
            var round = _a.round, place = _a.place, score = _a.score;
            return "Omg\u00E5ng ".concat(round, " \u00B7 plats ").concat(place, " (").concat(score, " p)");
        }).join(", ");
        [wins, lastPlace == null ? "–" : lastPlace, history].forEach(function (value) {
            var cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        return row;
    }));
}
function renderPersonalResult() {
    var card = element("personal-result");
    var visible = role !== "tv" && state && typeof state.yourPlace === "number";
    card.hidden = !visible;
    if (!visible)
        return;
    var yourPlace = state.yourPlace, yourScore = state.yourScore, players = state.players;
    var shared = players.filter(function (player) { return player.score === yourScore; }).length > 1;
    var text = "".concat(shared ? "Delad plats" : "Plats", " ").concat(yourPlace, " \u00B7 ").concat(yourScore, " po\u00E4ng");
    var value = element("personal-score");
    if (value.textContent !== text)
        value.textContent = text;
}
function namedChoice(question, choice) {
    return "".concat(letters[choice], " \u00B7 ").concat(question.choices[choice]);
}
function reviewReportTicket() {
    if (role === "tv" || !state || state.phase !== "review" || !state.review)
        return "";
    var ticket = state.review.question.reportTicket;
    return typeof ticket === "string" ? ticket : "";
}
function renderReviewReport() {
    var ticket = reviewReportTicket();
    var wrapper = element("review-report");
    wrapper.hidden = !ticket;
    if (!ticket)
        return;
    var status = reportStatuses[state.review.question.id];
    var message = status === "sent" ? "Frågan är rapporterad."
        : status === "failed" ? "Rapporten kunde inte skickas. Försök igen."
            : status === "sending" ? "Skickar rapporten…" : "";
    element("report-question").disabled = status === "sent" || status === "sending";
    var statusLine = element("report-status");
    if (statusLine.textContent !== message)
        statusLine.textContent = message;
    statusLine.hidden = !message;
}
function reportReviewQuestion() {
    return __awaiter(this, void 0, void 0, function () {
        var ticket, id, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    ticket = reviewReportTicket();
                    if (!ticket)
                        return [2 /*return*/];
                    id = state.review.question.id;
                    if (reportStatuses[id] === "sent" || reportStatuses[id] === "sending")
                        return [2 /*return*/];
                    reportStatuses[id] = "sending";
                    renderReviewReport();
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, request("/api/question-reports", { method: "POST", body: { ticket: ticket } })];
                case 2:
                    _b.sent();
                    reportStatuses[id] = "sent";
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    reportStatuses[id] = "failed";
                    return [3 /*break*/, 4];
                case 4:
                    renderReviewReport();
                    return [2 /*return*/];
            }
        });
    });
}
function renderReview() {
    showSection("review");
    var _a = state.review, current = _a.current, total = _a.total, question = _a.question, answers = _a.answers;
    element("review-actions").hidden = role !== "host";
    element("review-prev").disabled = current <= 1 || Boolean(pending);
    element("review-next").disabled = current >= total || Boolean(pending);
    element("new-round-review").hidden = role !== "host";
    element("new-round-review").disabled = Boolean(pending);
    element("restart-review").hidden = role !== "tv";
    element("restart-review").disabled = Boolean(pending);
    renderReviewReport();
    if (reviewKey === question.id)
        return;
    reviewKey = question.id;
    element("review-round").textContent = "Fr\u00E5ga ".concat(current, " av ").concat(total);
    element("review-question").textContent = question.text;
    element("review-correct").textContent = "R\u00E4tt svar \u00E4r ".concat(namedChoice(question, question.correctChoice));
    renderReviewSource(question);
    replaceContents(element("review-choices"), question.choices.map(function (answer, index) {
        var option = choiceCard(answer, index, "div");
        option.classList.toggle("correct", index === question.correctChoice);
        return option;
    }));
    replaceContents(element("review-answers"), answers.map(function (_a) {
        var name = _a.name, choice = _a.choice;
        var row = document.createElement("tr");
        var player = document.createElement("th");
        player.scope = "row";
        player.textContent = name;
        var answer = document.createElement("td");
        answer.className = "review-picked";
        answer.textContent = choice === null ? "Inget svar" : namedChoice(question, choice);
        answer.classList.toggle("correct", choice === question.correctChoice);
        row.appendChild(player);
        row.appendChild(answer);
        return row;
    }));
    if (role === "tv")
        main.scrollTop = 0;
}
function updateTimer() {
    var timer = element("timer");
    timer.hidden = !state || state.phase !== "question" || !state.deadline;
    if (timer.hidden)
        return;
    var remaining = Math.max(0, Math.ceil(state.deadline - Date.now() / 1000));
    timer.classList.toggle("ending", remaining <= 5);
    var label = "".concat(remaining, " s kvar");
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
        }
        catch (_a) {
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
    if (!state || state.phase !== "question")
        clearDraft();
    if (role === "tv" && qrKey && (!state || state.phase !== "lobby"))
        resetQr();
    if (!state) {
        if (role === "tv") {
            showSection("startup");
            element("startup-status").hidden = !pending;
            element("retry-room").hidden = Boolean(pending);
        }
        else if (role === "player" && !token) {
            showSection("join");
            element("join-form").querySelector("button").disabled = Boolean(pending);
        }
        else {
            showSection();
        }
        return;
    }
    var roundKey = "".concat(room, "-").concat(state.roundNumber || 1);
    if (state.phase === "lobby")
        renderLobby();
    else if (state.phase === "finished") {
        if (role === "tv") {
            finishedRound = roundKey;
            scoreboardUntil = 0;
        }
        renderScores();
    }
    else if (state.phase === "review") {
        if (role === "tv" && finishedRound !== roundKey) {
            // A fast host can open the review between two TV polls.
            finishedRound = roundKey;
            scoreboardUntil = Date.now() + 1800;
        }
        if (role === "tv" && Date.now() < scoreboardUntil)
            renderScores();
        else
            renderReview();
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
        openTvRoom();
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
element("retry-room").addEventListener("click", function () { return openTvRoom(); });
element("retry-qr").addEventListener("click", function () {
    qrFailed = false;
    updateQr();
});
["cancel-room", "new-game", "restart-review"].forEach(function (id) {
    element(id).addEventListener("click", function () { return openTvRoom(true); });
});
element("join-form").addEventListener("submit", joinRoom);
element("host-plays").addEventListener("change", function (event) {
    showHostName(event.target.checked);
    scheduleHostParticipation();
});
element("host-name").addEventListener("input", scheduleHostParticipation);
["category", "amount", "difficulty", "festmix-themes"].forEach(function (id) {
    element(id).addEventListener("change", clearRepeatShortage);
});
function updateFestmixThemeVisibility() {
    element("festmix-themes").hidden = element("category").value !== "party";
}
element("category").addEventListener("change", updateFestmixThemeVisibility);
updateFestmixThemeVisibility();
element("host-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var selected = element("category").value;
    var allowRepeats = repeatShortage && repeatShortage.settingsKey === startSettingsKey() && element("allow-repeats").checked;
    var category = selected;
    if (selected === "random") {
        category = allowRepeats ? repeatShortage.category : categories[Math.floor(Math.random() * categories.length)];
    }
    var body = {
        amount: Number(element("amount").value),
        category: category,
        difficulty: element("difficulty").value,
        seconds: Number(element("seconds").value),
    };
    var themes = selectedFestmixThemes();
    if (themes.length)
        body.themes = themes;
    if (allowRepeats)
        body.allowRepeats = true;
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
    roomAction("start", body).then(function () {
        if (state && state.phase === "lobby")
            scheduleHostParticipation();
    });
});
element("next").addEventListener("click", function () { return roomAction("next"); });
element("open-review").addEventListener("click", function () { return roomAction("review", { questionNumber: 1 }); });
element("report-question").addEventListener("click", reportReviewQuestion);
element("new-round").addEventListener("click", function () { return roomAction("new-round"); });
element("new-round-review").addEventListener("click", function () { return roomAction("new-round"); });
element("review-prev").addEventListener("click", function () { return roomAction("review", { questionNumber: state.review.current - 1 }); });
element("review-next").addEventListener("click", function () { return roomAction("review", { questionNumber: state.review.current + 1 }); });
function configureFullscreen() {
    var _this = this;
    if (role !== "tv")
        return;
    var screen = document.documentElement;
    var standard = screen.requestFullscreen && document.fullscreenEnabled !== false;
    var enter = standard ? screen.requestFullscreen : screen.webkitRequestFullscreen || screen.webkitRequestFullScreen;
    if (!enter)
        return;
    var button = element("fullscreen-button");
    var active = function () { return Boolean(document.fullscreenElement || document.webkitFullscreenElement
        || document.webkitCurrentFullScreenElement || document.webkitIsFullScreen); };
    var sync = function () {
        var fullscreen = active();
        document.body.classList.toggle("fullscreen-active", fullscreen);
        button.hidden = fullscreen;
        button.setAttribute("aria-pressed", String(fullscreen));
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    button.addEventListener("click", function () { return __awaiter(_this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 5, , 6]);
                    if (!standard) return [3 /*break*/, 2];
                    return [4 /*yield*/, enter.call(screen, { navigationUI: "hide" })];
                case 1:
                    _b.sent();
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, enter.call(screen)];
                case 3:
                    _b.sent();
                    _b.label = 4;
                case 4: return [3 /*break*/, 6];
                case 5:
                    _a = _b.sent();
                    notice("Det gick inte att öppna helskärm.");
                    return [3 /*break*/, 6];
                case 6:
                    sync();
                    return [2 /*return*/];
            }
        });
    }); });
    sync();
    if (!button.hidden)
        button.focus();
}
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
configureFullscreen();
init();
element("boot-status").hidden = true;
setInterval(updateTimer, 250);
