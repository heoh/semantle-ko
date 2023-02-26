/*
    Copyright (c) 2022, Newsjelly, forked from Semantlich by Johannes Gätjen semantlich.johannesgaetjen.de and Semantle by David Turner <novalis@novalis.org> semantle.novalis.org

    This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.

    This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
'use strict';

let days = [];
let gameOver = false;
let guesses = [];
let guessed = new Set();
let guessCount = 0;
let model = null;
let numPuzzles = 4650;
const now = Date.now();
const initialDate = new Date('2022-04-01T00:00:00+09:00');
const puzzleNumber = (Math.floor((new Date() - initialDate) / 86400000) - 1) % numPuzzles;
const yesterdayPuzzleNumber = (puzzleNumber + numPuzzles - 1) % numPuzzles;
const storage = window.localStorage;
let chrono_forward = -1;
let prefersDarkColorScheme = false;
// settings
let darkMode = storage.getItem("darkMode") === 'true';
let shareGuesses = storage.getItem("shareGuesses") === 'false' ? false: true;
let shareTime = storage.getItem("shareTime") === 'false' ? false: true;
let shareTopGuess = storage.getItem("shareTopGuess") === 'false' ? false: true;

function $(id) {
    if (id.charAt(0) !== '#') return false;
    return document.getElementById(id.substring(1));
}

function share() {
    // We use the stored guesses here, because those are not updated again
    // once you win -- we don't want to include post-win guesses here.
    const text = solveStory(JSON.parse(storage.getItem("guesses")), puzzleNumber);
    const copied = ClipboardJS.copy(text);

    if (copied) {
        gtag('event', 'share', {
            'puzzle_number' : puzzleNumber,
        });
        alert("클립보드로 복사했습니다.");
    }
    else {
        alert("클립보드에 복사할 수 없습니다.");
    }
}

const words_selected = [];
const cache = {};
let similarityStory = null;

function dayRow(day, leader) {
    let dayText = `${day}번째 꼬맨틀`;
    let leaderText = leader ? leader.nickname : '';
    return `<tr>
        <td><a href="/${day}">${dayText}</a></td>
        <td>${leaderText}</td>
    </tr>`;
}

function getUpdateTimeHours() {
    const midnightUtc = new Date();
    midnightUtc.setUTCHours(24 - 9, 0, 0, 0);
    return midnightUtc.getHours();
}

function solveStory(guesses, puzzleNumber) {
    let guess_count = guesses.length - 1;
    let is_win = storage.getItem("winState") == 1;
    if (is_win) {
        guess_count += 1
        if (guess_count == 1) {
            return `이럴 수가! 첫번째 추측에서 ${puzzleNumber}번째 꼬맨틀 정답 단어를 맞혔습니다!\nhttps://semantle-ko.newsjel.ly/`;
        }
    }
    if (guess_count == 0) {
        return `${puzzleNumber}번째 꼬맨틀을 시도하지 않고 바로 포기했어요.\nhttps://semantle-ko.newsjel.ly/`;
    }

    let describe = function(similarity, percentile) {
        let out = `${similarity.toFixed(2)}`;
        if (percentile != '1000위 이상') {
            out += ` (순위 ${percentile})`;
        }
        return out;
    }

    let time = storage.getItem('endTime') - storage.getItem('startTime');
    let timeFormatted = new Date(time).toISOString().substr(11, 8).replace(":", "시간").replace(":", "분");
    let timeInfo = `소요 시간: ${timeFormatted}초\n`
    if (time > 24 * 3600000) {
        timeInfo = '소요 시간: 24시간 이상\n'
    }
    if (!shareTime) {
        timeInfo = ''
    }

    let topGuessMsg = ''
    const topGuesses = guesses.slice();
    if (shareTopGuess) {
        topGuesses.sort(function(a, b){return b[0]-a[0]});
        const topGuess = topGuesses[1];
        let [similarity, old_guess, percentile, guess_number] = topGuess;
        topGuessMsg = `최대 유사도: ${describe(similarity, percentile)}\n`;
    }
    let guessCountInfo = '';
    if (shareGuesses) {
        guessCountInfo = `추측 횟수: ${guess_count}\n`;
    }

    if (is_win) {
        return `${puzzleNumber}번째 꼬맨틀을 풀었습니다!\n${guessCountInfo}` +
            `${timeInfo}${topGuessMsg}https://semantle-ko.newsjel.ly/`;
    }

    return `저런… ${puzzleNumber}번째 꼬맨틀을 포기했어요..ㅠ\n${guessCountInfo}` +
            `${timeInfo}${topGuessMsg}https://semantle-ko.newsjel.ly/`;
}

let Semantle = (function() {
    async function getDays() {
        const url = "/days";
        try {
            return (await fetch(url)).json();
        } catch (e) {
            return null;
        }
    }

    async function init() {
        days = await getDays();
        updateDays();

        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            prefersDarkColorScheme = true;
        }

        $("#settings-button").addEventListener('click', openSettings);

        document.querySelectorAll(".dialog-underlay, .dialog-close").forEach((el) => {
            el.addEventListener('click', () => {
                document.body.classList.remove('dialog-open', 'settings-open');
            });
        });

        document.querySelectorAll(".dialog").forEach((el) => {
            el.addEventListener("click", (event) => {
                // prevents click from propagating to the underlay, which closes the dialog
                event.stopPropagation();
            });
        });

        $('#dark-mode').addEventListener('click', function(event) {
            storage.setItem('darkMode', event.target.checked);
            toggleDarkMode(event.target.checked);
        });

        toggleDarkMode(darkMode);

        $('#share-guesses').addEventListener('click', function(event) {
            storage.setItem('shareGuesses', event.target.checked);
            shareGuesses = event.target.checked;
        });

        $('#share-time').addEventListener('click', function(event) {
            storage.setItem('shareTime', event.target.checked);
            shareTime = event.target.checked;
        });

        $('#share-top-guess').addEventListener('click', function(event) {
            storage.setItem('shareTopGuess', event.target.checked);
            shareTopGuess = event.target.checked;
        });

        $('#dark-mode').checked = darkMode;
        $('#share-guesses').checked = shareGuesses;
        $('#share-time').checked = shareTime;
        $('#share-top-guess').checked = shareTopGuess;
    }

    function updateDays() {
        let inner = `<tr><th id="chronoOrder">회차</th><th>1등</th></tr>`;
        inner += "<tr><td colspan=4><hr></td></tr>";
        for (const entry of days) {
            const { day, leader } = entry;
            inner += dayRow(day, leader);
        }
        $('#days').innerHTML = inner;
        $('#chronoOrder').addEventListener('click', event => {
            days.sort(function(a, b){return chrono_forward * (a['day']-b['day'])});
            chrono_forward *= -1;
            updateDays();
        });
    }


    function openSettings() {
        document.body.classList.add('dialog-open', 'settings-open');
    }

    function toggleDarkMode(on) {
        document.body.classList[on ? 'add' : 'remove']('dark');
        const darkModeCheckbox = $("#dark-mode");
        darkMode = on;
        // this runs before the DOM is ready, so we need to check
        if (darkModeCheckbox) {
            darkModeCheckbox.checked = on;
        }
    }

    function checkMedia() {
        let darkMode = storage.getItem("darkMode") === 'true';
        toggleDarkMode(darkMode);
    }

    function setSnowMode() {
        let days = Math.floor(Date.now() / 1000 / 60 / 60 / 24)
        let on = days % 3 === 0
        document.body.classList[on ? 'add' : 'remove']('snow');
    }

    return {
        init: init,
        checkMedia: checkMedia,
        setSnowMode: setSnowMode,
    };
})();

// do this when the file loads instead of waiting for DOM to be ready to avoid
// a flash of unstyled content
Semantle.checkMedia();
Semantle.setSnowMode();
    
window.addEventListener('load', async () => { Semantle.init() });
