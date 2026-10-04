/* ==========================================================================
 * tg-emoji.js - Telegram uslubidagi emoji paneli
 * --------------------------------------------------------------------------
 * Kompozitordagi bitta "ifrit" tugmasi bosilganda ochiladigan panelning
 * "Emoji" qismi. Barcha emoji oddiy Unicode belgilar - ular Telegram'da
 * `SendMessage` orqali tabiiy ko'rinadi (alohida yuklash shart emas).
 *
 * Ishlatilgan emojilar `localStorage['wc_tg_emoji_recent_v1']` da saqlanadi
 * va tepada "So'nggi" bo'limida chiqadi (Telegram'dagi kabi).
 * ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'wc_tg_emoji_recent_v1';
  var MAX_RECENT = 40;

  // Tez-tez ishlatiladigan emojilar (Telegram'dagi kabi "ko'p ishlatilgan").
  var FREQUENT = [
    '👍', '🙏', '🔥', '❤️', '😂', '😍', '😁', '👌', '💪', '😊',
    '👏', '🎉', '🤝', '✅', '💯', '😎', '🤔', '😢', '😡', '🤗',
    '🥰', '😴', '🤯', '🫡', '🤌', '👀', '🕐', '💡', '🎬', '🍿'
  ];

  // Barcha guruhlar. Har biri { icon, name, list }.
  var GROUPS = [
    { icon: '😀', name: 'Yuzlar', list:
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👹 👺 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾' },

    { icon: '🤝', name: 'Qo‘l va odamlar', list:
      '👋 🤚 🖐️ ✋ 🖖️ 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 💋 🧑 👶 👦 👧 👨 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 💏 💑 👪 🗣️ 👤 👥 🫂' },

    { icon: '🐶', name: 'Hayvonlar va tabiat', list:
      '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦤 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌈 ⭐ 🌟 ☀️ 🌙 ☁️ 🌧️ ⛈️ ❄️ ☃️ ⛄ 💧 🔥' },

    { icon: '🍔', name: 'Taomlar', list:
      '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🍗 🍖 🥩 🍤 🍣 🍱 🥟 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾' },

    { icon: '⚽', name: 'Faoliyat', list:
      '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛴 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚴 🚵 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🪗 🎸 🎻 🎯 🎳 🎮 🎰 🧩 🎲 🃏 🎴 🎡 🎢 🎠' },

    { icon: '🚀', name: 'Yo‘l va joylar', list:
      '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ 🚢 ⚓️ ⛽ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋' },

    { icon: '💡', name: 'Narsalar', list:
      '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 💊 💉 🩹 🩺 🌡️ 🧹 🧺 🧻 🚽 🚿 🛁 🧼 🪥 🧽 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🖼️ 🛍️ 🎁 🎈 🎏 🎀 🎊 🎉 🔔 🎎 🏮 🎐 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 🗂️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓' },

    { icon: '❤️', name: 'Belgilar', list:
      '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✨ 💫 ⚡ 💥 ☄️ 💦 ☔ ☮️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ ☑️ ✔️ ❎ ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲' }
  ];

  function split(s) { return String(s).trim().split(/\s+/); }

  // --------------------------------------------------- "So'nggi" (localStorage)
  function readRecent() {
    try {
      var raw = global.localStorage ? localStorage.getItem(KEY) : '';
      var a = raw ? JSON.parse(raw) : null;
      return Array.isArray(a) ? a.filter(function (e) { return typeof e === 'string' && e; }) : [];
    } catch (e) { return []; }
  }
  function writeRecent(list) {
    try {
      if (global.localStorage) {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
      }
    } catch (e) {}
  }
  function push(e) {
    var list = readRecent().filter(function (x) { return x !== e; });
    list.unshift(e);
    writeRecent(list);
  }

  /** Barcha guruhlarni render uchun tayyorlaydi (So'nggi tepada). */
  function sections() {
    var out = [];
    var recent = readRecent();
    if (recent.length) out.push({ icon: '🕘', name: 'So‘nggi', list: recent });
    out.push({ icon: '⭐', name: 'Ko‘p ishlatilgan', list: FREQUENT });
    GROUPS.forEach(function (g) { out.push({ icon: g.icon, name: g.name, list: split(g.list) }); });
    return out;
  }

  /** Tanlangan emoji ro'yxatini qaytaradi (picking uchun). */
  function all() {
    var s = sections();
    return s.reduce(function (acc, g) { return acc.concat(g.list); }, []);
  }

  global.TgEmoji = {
    sections: sections,
    all: all,
    pushRecent: push,
    recent: readRecent,
    clearRecent: function () { writeRecent([]); }
  };
})(window);