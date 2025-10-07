/*!
 * Minimal MD5 implementation adapted from blueimp-md5 v2.19.0 (MIT License).
 * https://github.com/blueimp/JavaScript-MD5
 */
(function (window) {
  'use strict';

  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }

  function bitRotateLeft(num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt));
  }

  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }

  function md5ff(a, b, c, d, x, s, t) {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }

  function md5gg(a, b, c, d, x, s, t) {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }

  function md5hh(a, b, c, d, x, s, t) {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function md5ii(a, b, c, d, x, s, t) {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  function binlMD5(x, len) {
    /* append padding */
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;

    let i;
    let olda;
    let oldb;
    let oldc;
    let oldd;
    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (i = 0; i < x.length; i += 16) {
      olda = a;
      oldb = b;
      oldc = c;
      oldd = d;

      a = md5ff(a, b, c, d, x[i], 7, -680876936);
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
      b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);

      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);

      a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = md5hh(d, a, b, c, x[i], 11, -358537222);
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);

      a = md5ii(a, b, c, d, x[i], 6, -198630844);
      d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);

      a = safeAdd(a, olda);
      b = safeAdd(b, oldb);
      c = safeAdd(c, oldc);
      d = safeAdd(d, oldd);
    }

    return [a, b, c, d];
  }

  function binl2rstr(input) {
    let i;
    let output = '';
    const length32 = input.length * 32;
    for (i = 0; i < length32; i += 8) {
      output += String.fromCharCode((input[i >> 5] >>> (i % 32)) & 0xff);
    }
    return output;
  }

  function rstr2binl(input) {
    const output = [];
    output[(input.length >> 2) - 1] = undefined;
    for (let i = 0; i < output.length; i += 1) {
      output[i] = 0;
    }
    const length8 = input.length * 8;
    for (let i = 0; i < length8; i += 8) {
      output[i >> 5] |= (input.charCodeAt(i / 8) & 0xff) << (i % 32);
    }
    return output;
  }

  function rstrMD5(s) {
    return binl2rstr(binlMD5(rstr2binl(s), s.length * 8));
  }

  function rstr2hex(input) {
    const hexTab = '0123456789abcdef';
    let output = '';
    let x;
    for (let i = 0; i < input.length; i += 1) {
      x = input.charCodeAt(i);
      output += hexTab.charAt((x >>> 4) & 0x0f) + hexTab.charAt(x & 0x0f);
    }
    return output;
  }

  function str2rstrUTF8(input) {
    return unescape(encodeURIComponent(input));
  }

  function rawMD5(s) {
    return rstrMD5(str2rstrUTF8(s));
  }

  function md5(string) {
    return rstr2hex(rawMD5(string));
  }

  function normalizeTimestamp(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string') {
      const numeric = parseInt(value, 10);
      if (!Number.isNaN(numeric)) return numeric;
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return Math.trunc(ms);
    }
    return 0;
  }

  function parseUnitLesson(questionId) {
    if (typeof questionId !== 'string') return null;
    const match = questionId.match(/U(\d+)-L(\d+)/i);
    if (!match) return null;
    const unitNumber = parseInt(match[1], 10);
    const lessonNumber = parseInt(match[2], 10);
    return {
      unitId: `unit${unitNumber}`,
      lessonId: `U${unitNumber}-L${lessonNumber}`
    };
  }

  function canonicalizeLessonAnswers(answers) {
    const sorted = (answers || [])
      .map((answer) => ({
        username: (answer.username || '').trim(),
        question_id: answer.question_id,
        answer_value: answer.answer_value ?? null,
        timestamp: normalizeTimestamp(answer.timestamp)
      }))
      .filter((answer) => answer.username && typeof answer.question_id === 'string')
      .sort((a, b) => {
        const userCompare = a.username.localeCompare(b.username);
        if (userCompare !== 0) return userCompare;
        const questionCompare = a.question_id.localeCompare(b.question_id);
        if (questionCompare !== 0) return questionCompare;
        return a.timestamp - b.timestamp;
      });

    return JSON.stringify(sorted);
  }

  function computeLessonHash(answers) {
    return md5(canonicalizeLessonAnswers(answers));
  }

  function computeUnitHashFromLessons(lessons) {
    const entries = Object.keys(lessons)
      .sort((a, b) => a.localeCompare(b))
      .map((lessonId) => ({ lessonId, hash: lessons[lessonId].hash }));
    return md5(JSON.stringify(entries));
  }

  function gatherAllLocalAnswers() {
    const deduped = new Map();

    function addAnswer(username, questionId, value, timestamp) {
      if (!username || !questionId) return;
      const key = `${username.trim()}::${questionId}`;
      const normalized = {
        username: username.trim(),
        question_id: questionId,
        answer_value: value ?? null,
        timestamp: normalizeTimestamp(timestamp)
      };
      const existing = deduped.get(key);
      if (!existing || normalized.timestamp >= existing.timestamp) {
        deduped.set(key, normalized);
      }
    }

    const classData = window.classData;
    if (classData && classData.users) {
      Object.entries(classData.users).forEach(([username, data]) => {
        const answers = data?.answers || {};
        Object.entries(answers).forEach(([questionId, info]) => {
          const answerValue = info?.value ?? info;
          const timestamp = data?.timestamps?.[questionId] ?? info?.timestamp ?? 0;
          addAnswer(username, questionId, answerValue, timestamp);
        });
      });
    }

    Object.keys(localStorage)
      .filter((key) => key.startsWith('answers_'))
      .forEach((key) => {
        try {
          const username = key.replace('answers_', '');
          const stored = JSON.parse(localStorage.getItem(key) || '{}');
          Object.entries(stored).forEach(([questionId, info]) => {
            const answerValue = info?.value ?? info;
            const timestamp = info?.timestamp ?? 0;
            addAnswer(username, questionId, answerValue, timestamp);
          });
        } catch (error) {
          console.warn('Failed to parse localStorage answers for key', key, error);
        }
      });

    return Array.from(deduped.values());
  }

  function buildLocalSyncIndex() {
    const answers = gatherAllLocalAnswers();
    const unitBuckets = new Map();

    answers.forEach((answer) => {
      const mapping = parseUnitLesson(answer.question_id);
      if (!mapping) return;

      let lessonBuckets = unitBuckets.get(mapping.unitId);
      if (!lessonBuckets) {
        lessonBuckets = new Map();
        unitBuckets.set(mapping.unitId, lessonBuckets);
      }

      let lessonMap = lessonBuckets.get(mapping.lessonId);
      if (!lessonMap) {
        lessonMap = new Map();
        lessonBuckets.set(mapping.lessonId, lessonMap);
      }

      const key = `${answer.username}::${answer.question_id}`;
      const existing = lessonMap.get(key);
      if (!existing || answer.timestamp >= existing.timestamp) {
        lessonMap.set(key, answer);
      }
    });

    const units = {};

    unitBuckets.forEach((lessonBuckets, unitId) => {
      const lessons = {};
      lessonBuckets.forEach((answerMap, lessonId) => {
        const answersArray = Array.from(answerMap.values()).sort((a, b) => {
          const userCompare = a.username.localeCompare(b.username);
          if (userCompare !== 0) return userCompare;
          const questionCompare = a.question_id.localeCompare(b.question_id);
          if (questionCompare !== 0) return questionCompare;
          return a.timestamp - b.timestamp;
        });
        lessons[lessonId] = {
          hash: computeLessonHash(answersArray),
          answers: answersArray,
          answerCount: answersArray.length
        };
      });
      units[unitId] = {
        hash: computeUnitHashFromLessons(lessons),
        lessons
      };
    });

    return { units };
  }

  window.HashUtils = {
    md5,
    normalizeTimestamp,
    parseUnitLesson,
    canonicalizeLessonAnswers,
    computeLessonHash,
    computeUnitHashFromLessons,
    buildLocalSyncIndex,
    gatherAllLocalAnswers
  };
})(window);
