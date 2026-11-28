(() => {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  let state = null;
  let selectedDevices = 0;
  let pendingPayment = null;
  let busy = false;
  let loadingInFlight = false;
  let checkingPayment = false;
  let confirmedPollTimer = null;
  let lastAccessMode = null;
  let chartResizeTimer = null;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes?.();
  }

  const THEME_STORAGE_KEY = 'nexus_theme_pref';
  const themeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
  let themePref = 'auto';
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto') themePref = savedTheme;
  } catch (_) {}

  function resolveTheme(pref = themePref) {
    if (pref === 'dark' || pref === 'light') return pref;
    if (tg?.colorScheme === 'dark' || tg?.colorScheme === 'light') return tg.colorScheme;
    return themeMedia?.matches ? 'dark' : 'light';
  }

  function applyTheme(pref = themePref, persist = false) {
    themePref = (pref === 'light' || pref === 'dark') ? pref : 'auto';
    if (persist) {
      try { localStorage.setItem(THEME_STORAGE_KEY, themePref); } catch (_) {}
    }
    const resolved = resolveTheme(themePref);
    document.documentElement.dataset.theme = resolved;
    const chromeColor = resolved === 'dark' ? '#161310' : '#cbb8a4';
    const metaTheme = $('meta-theme-color');
    if (metaTheme) metaTheme.setAttribute('content', chromeColor);
    tg?.setHeaderColor?.(chromeColor);
    tg?.setBackgroundColor?.(chromeColor);
    tg?.setBottomBarColor?.(chromeColor);

    const themeSub = $('theme-sub');
    if (themeSub) {
      themeSub.textContent = themePref === 'auto'
        ? `Как в Telegram (${resolved === 'dark' ? 'ночь' : 'день'})`
        : themePref === 'dark'
          ? 'Тёмная тема'
          : 'Светлая тема';
    }
    document.querySelectorAll('#theme-pills [data-theme-pref]').forEach((btn) => {
      const active = btn.dataset.themePref === themePref;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (state) requestAnimationFrame(() => renderTrafficChart());
  }

  applyTheme(themePref, false);
  tg?.onEvent?.('themeChanged', () => { if (themePref === 'auto') applyTheme('auto', false); });
  themeMedia?.addEventListener?.('change', () => { if (themePref === 'auto') applyTheme('auto', false); });

  const supportsNativeDownload = () => Boolean(tg?.isVersionAtLeast?.('8.0') && typeof tg?.downloadFile === 'function');

  const haptic = (kind = 'light') => tg?.HapticFeedback?.impactOccurred?.(kind);
  const hapticSelect = () => tg?.HapticFeedback?.selectionChanged?.();
  const notify = (message) => {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.classList.remove('show'), 2800);
  };

  const fmtDate = (seconds) => seconds ? new Intl.DateTimeFormat('ru-RU', {day:'2-digit',month:'short',year:'numeric'}).format(new Date(seconds * 1000)).replace(/\s*г\.?$/i, '') : '—';
  const fmtDateTime = (seconds) => seconds ? new Intl.DateTimeFormat('ru-RU', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(seconds * 1000)) : '';
  const openExternal = (url) => { if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank'); };
  const openTgUrl = (url) => { if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank'); };

  const statusText = {active:'Активна',frozen:'Заморожена',expired:'Истекла',deleted:'Истекла',inactive:'Отключена',none:'Нет подписки'};
  const paymentText = {pending:'Ожидает оплаты',confirmed:'Подтверждён',processing:'Выдаём доступ',applied:'Оплачен',canceled:'Отменён',failed:'Нужна проверка',manual_review:'Ручная проверка'};

  const pluralRu = (n, one, few, many) => {
    const abs = Math.abs(Number(n) || 0), m100 = abs % 100, m10 = abs % 10;
    if (m100 >= 11 && m100 <= 14) return many;
    if (m10 === 1) return one;
    if (m10 >= 2 && m10 <= 4) return few;
    return many;
  };
  const monthWord = (n) => `${n}\u00A0${pluralRu(n, 'месяц', 'месяца', 'месяцев')}`;
  const deviceWord = (n) => `${n}\u00A0${pluralRu(n, 'устройство', 'устройства', 'устройств')}`;
  const deviceGenWord = (n) => `${n}\u00A0${pluralRu(n, 'устройства', 'устройств', 'устройств')}`;
  const slotWord = (n) => `${n}\u00A0${pluralRu(n, 'место', 'места', 'мест')}`;
  const hourWord = (n) => `${n}\u00A0${pluralRu(n, 'час', 'часа', 'часов')}`;
  const daysRemainingLabel = (n) => {
    const abs = Math.abs(Number(n) || 0), m100 = abs % 100, m10 = abs % 10;
    if (m100 >= 11 && m100 <= 14) return 'дней осталось';
    if (m10 === 1) return 'день остался';
    if (m10 >= 2 && m10 <= 4) return 'дня осталось';
    return 'дней осталось';
  };
  const nbsp = (s) => String(s ?? '').replace(/(^|[\s«(])([вкосуиаВКОСУИА])\s+/g, '$1$2\u00A0');
  const operationId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const copyText = async (text, okMsg = 'Скопировано') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        haptic('light');
        notify(okMsg);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      haptic('light');
      notify(okMsg);
      return true;
    } catch (_) {
      notify('Не удалось скопировать');
      return false;
    }
  };

  const detectOs = () => {
    const p = String(tg?.platform || '').toLowerCase();
    const ua = String(navigator.userAgent || '').toLowerCase();
    if (p === 'ios' || /iphone|ipad|ipod/.test(ua)) return 'ios';
    if (p === 'android' || /android/.test(ua)) return 'android';
    if (p === 'macos' || /macintosh|mac os x/.test(ua)) return 'macos';
    if (p === 'tdesktop' && /windows/.test(ua)) return 'windows';
    if (/windows/.test(ua)) return 'windows';
    return 'ios';
  };

  const hashSeed = (id, bucket, salt = 0) => {
    let seed = (Number(id) || 1) ^ Math.imul(bucket + salt, 2654435761);
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    return (seed ^ (seed >>> 16)) >>> 0;
  };
  const DAILY_MESSAGES = [
    (n) => `${n}, самое время поверить в себя`,
    (n) => `${n}, ваша интуиция сегодня не подведёт`,
    (n) => `${n}, сегодня всё сложится как надо`,
    (n) => `${n}, вы ближе к цели, чем кажется`,
    (n) => `${n}, впереди кое-что очень хорошее`,
    (n) => `${n}, вы справляетесь лучше, чем думаете`,
    (n) => `${n}, ваш внутренний настрой решает многое`,
    (n) => `${n}, хороший поворот уже начался`,
    (n) => `${n}, доверьтесь своему первому ощущению`,
    (n) => `${n}, сегодня день спокойных побед`,
    (n) => `${n}, всё лишнее сегодня уйдёт само`,
    (n) => `${n}, правильный момент уже наступил`,
    (n) => `${n}, ваш ритм сегодня — самый верный`,
    (n) => `${n}, вы точно на своём месте`,
    (n) => `${n}, спокойствие сегодня — ваша суперсила`,
    (n) => `${n}, день приготовил приятный сюрприз`,
    (n) => `${n}, смелее — обстоятельства за вас`,
    (n) => `${n}, ваша выдержка скоро окупится`,
    (n) => `${n}, сегодня легко найдётся верный ответ`,
    (n) => `${n}, доверьтесь ходу событий`,
    (n) => `${n}, вы видите глубже, чем остальные`,
    (n) => `${n}, этот день работает в вашу пользу`,
    (n) => `${n}, маленькие шаги ведут к большому`,
    (n) => `${n}, ваша уверенность меняет правила игры`,
    (n) => `${n}, сегодня стоит выбрать себя`,
    (n) => `${n}, ясный взгляд откроет новую дверь`,
    (n) => `${n}, то самое решение уже рядом`,
    (n) => `${n}, берегите свой внутренний огонь`,
    (n) => `${n}, сегодня удача любит спокойных`,
    (n) => `${n}, вы сильнее любых сомнений`,
    (n) => `${n}, впереди полоса ясных решений`,
    (n) => `${n}, пусть этот день будет лёгким`,
  ];
  const DAILY_PREDICTIONS = [
    'Вы долго держали в голове одно решение, выжидая подходящий момент — сегодня обстоятельства сами подскажут простой и верный шаг.',
    'Снаружи вы кажетесь спокойнее, чем чувствуете себя внутри. Сбавьте к себе строгость: вы уже сделали больше, чем сами себе засчитываете.',
    'Мысль, к которой вы мысленно возвращаетесь последние дни, не случайна — ваше первое интуитивное ощущение оказалось самым точным.',
    'Вы привыкли рассчитывать только на себя, но сегодня неожиданная мелочь или вовремя сказанное слово приятно упростит вам задачу.',
    'Не пытайтесь сегодня контролировать каждую деталь: небольшая пауза сбережёт вам больше сил и приведёт к лучшему результату, чем спешка.',
    'У вас есть редкое свойство замечать нюансы, которые упускают другие — сегодня именно эта наблюдательность сыграет вам на руку.',
    'То, в чём вы недавно сомневались, скоро повернётся в вашу пользу. Вы выбрали верное направление, даже если сначала путь казался непростым.',
    'Иногда вы требуете от себя максимума там, где достаточно одного спокойного шага. Сегодня день, когда стоит выбрать собственный комфорт.',
    'Небольшая перемена в планах сегодня окажется к лучшему и откроет более лёгкий вариант, о котором вы сначала даже не думали.',
    'Внутри вас сейчас гораздо больше запаса прочности, чем кажется — стоит только начать, и нужное решение сложится само собой.',
    'Вопрос, который фоном забирал ваше внимание на этой неделе, решится проще и спокойнее, чем рисовало воображение.',
    'Вы часто ставите задачи других выше своих, но сегодня отличный повод сделать выбор в свою пользу — без лишних сомнений.',
    'Человек или хорошая новость, о которых вы недавно вспоминали, совсем скоро напомнят о себе с приятной стороны.',
    'Ваше умение сохранять холодную голову сегодня даст вам преимущество: пока остальные суетятся, вы спокойно заберёте лучший результат.',
    'Идея, которую вы отложили «на потом», снова актуальна — сейчас у вас уже достаточно опыта, чтобы реализовать её легко.',
    'Даже если день начался не совсем по расписанию, не торопитесь: эта небольшая пауза убережёт вас от лишней суеты.',
    'Вы тонко чувствуете фальшь и цените прямоту — сегодня именно ваша искренность поможет быстро договориться о важном.',
    'Порой вам проще сделать всё самостоятельно, чем объяснять другим, но сегодня делегирование одной мелочи освободит вечер для отдыха.',
    'То, что казалось задержкой или препятствием пару дней назад, сегодня раскроется как удачное стечение обстоятельств.',
    'Вы редко хвалите себя за промежуточные итоги, хотя за спиной уже огромный путь. Оглянитесь — вам правда есть чем гордиться.',
    'Сегодня случайная фраза в разговоре или переписке даст неожиданный ключ к вопросу, который давно крутился в голове.',
    'Ваш внутренний критик сегодня слишком строг. Позвольте себе сделать дело просто «достаточно хорошо» — результат вас приятно удивит.',
    'За внешней сдержанностью в вас скрывается мощный азарт к сложным задачам — сегодня появится повод включить его на полную.',
    'Вы умеете собираться в решающий момент лучше кого бы то ни было, но сегодня победы придут без лишнего напряжения.',
    'Незавершённое мелкое дело, которое давно висело в списке, сегодня закроется за десять минут и подарит редкое чувство лёгкости.',
    'Люди вокруг считывают вашу надёжность, даже когда вы молчите. Сегодня это доверие откроет перед вами неочевидную возможность.',
    'Иногда лучший ответ — не торопиться с ответом. Если сегодня кто-то ждёт от вас мгновенного решения, возьмите паузу до вечера.',
    'Вы долго настраивали баланс между делами и личным временем — сегодня отличный день, чтобы вовремя закрыть рабочие чаты.',
    'Старая привычка всё перепроверять дважды сегодня спасёт от чужой неточности и сэкономит кучу времени.',
    'Вы не любите пустых обещаний и суеты — сегодня день пройдёт именно в том чётком и понятном темпе, который вам по душе.',
    'Финансовый или рабочий вопрос, требующий расчёта, сегодня лучше решать на свежую голову: цифры сложатся удачнее, чем ожидалось.',
    'В вас сочетаются здоровая осторожность и смелость — сегодня стоит чуть больше довериться смелости.',
    'Даже короткая смена обстановки или прогулка без телефона сегодня перезагрузит мысли эффективнее долгих раздумий.',
    'Вы часто видите на два шага вперёд остальных, поэтому чужая медлительность порой раздражает. Дайте событиям дозреть самим.',
    'Сегодня хороший день для обновления — от наведения порядка на рабочем столе до смены старых привычных маршрутов.',
    'То, во что вы вкладывали силы без быстрой отдачи, начинает приносить первые заметные плоды. Продолжайте в том же духе.',
    'Ваше чувство юмора и самоирония сегодня разрядят обстановку там, где другие начнут спорить на пустом месте.',
    'Не удивляйтесь, если сегодня у вас попросят совета: ваш взгляд со стороны окажется самым трезвым и точным.',
    'Вы цените свободу выбора выше навязанных правил — сегодня поступите по-своему, и это окажется самым верным ходом.',
    'Внутреннее ощущение «пора что-то менять» появляется у вас только тогда, когда вы уже готовы к новому уровню.',
    'Сегодня интуиция подскажет, от какого лишнего обязательства можно вежливо отказаться без малейших потерь.',
    'Вы умеете хранить чужие секреты и держать слово — сегодня эта репутация вернётся к вам неожиданным бонусом.',
    'Если план «А» сегодня потребует слишком много усилий, присмотритесь к более простому альтернативному решению — оно сработает быстрее.',
    'Вы не из тех, кто сдаётся на полпути, но сегодня важно вовремя переключиться и дать голове отдохнуть.',
    'Приятная мелочь — от хорошей музыки в дороге до вовремя решённого вопроса — задаст правильный тон всему вечеру.',
    'Вы часто угадываете развитие событий раньше, чем появляются факты. Сегодня снова сработает это тонкое чутьё.',
    'День отлично подходит для того, чтобы закрыть старый хвост и освободить место в голове для действительно интересной идеи.',
    'Слова благодарности или признания, которые вы сегодня услышите, будут абсолютно заслуженными — не обесценивайте свой вклад.',
    'Когда вокруг слишком много информационного шума, вы умеете выделить главное. Сегодня этот фильтр сбережёт вам массу энергии.',
    'Спокойная уверенность без лишних слов сегодня произведёт гораздо большее впечатление, чем любые долгие аргументы.',
  ];
  const dailyFortune = (viewer) => {
    const uid = Number(viewer?.id) || 1;
    const now = new Date();
    const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dayBucket = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    const storageKey = `nexus_daily_fortune_v2:${uid}`;
    let msgIdx = hashSeed(uid, dayBucket, 17) % DAILY_MESSAGES.length;
    let predIdx = hashSeed(uid, dayBucket, 131) % DAILY_PREDICTIONS.length;
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.day === dayKey && Number.isInteger(saved.msgIdx) && Number.isInteger(saved.predIdx)) {
        msgIdx = saved.msgIdx % DAILY_MESSAGES.length;
        predIdx = saved.predIdx % DAILY_PREDICTIONS.length;
      } else {
        const rand = new Uint32Array(2);
        if (window.crypto?.getRandomValues) window.crypto.getRandomValues(rand);
        else { rand[0] = Math.random() * 0xffffffff; rand[1] = Math.random() * 0xffffffff; }
        msgIdx = (rand[0] ^ hashSeed(uid, dayBucket, 17)) >>> 0;
        predIdx = (rand[1] ^ hashSeed(uid, dayBucket, 131)) >>> 0;
        msgIdx %= DAILY_MESSAGES.length;
        predIdx %= DAILY_PREDICTIONS.length;
        if (saved && Number.isInteger(saved.predIdx) && predIdx === saved.predIdx % DAILY_PREDICTIONS.length) {
          predIdx = (predIdx + 1) % DAILY_PREDICTIONS.length;
        }
        localStorage.setItem(storageKey, JSON.stringify({ day: dayKey, msgIdx, predIdx }));
      }
    } catch (_) {}
    const name = viewer?.first_name || 'Друг';
    return {
      greeting: nbsp(DAILY_MESSAGES[msgIdx](name)),
      text: nbsp(DAILY_PREDICTIONS[predIdx]),
    };
  };

  const nodeLabel = (nodeCode, inactive) => {
    const code = String(nodeCode || '').toLowerCase();
    if (code.startsWith('s6') || code.startsWith('s4')) return 'Бельгия 🇧🇪';
    if (code.startsWith('s3')) return 'Австрия 🇦🇹';
    if (code.startsWith('s5') || code.startsWith('s2')) return 'Испания 🇪🇸';
    if (code.startsWith('s1')) return 'Нидерланды 🇳🇱';
    if (code.startsWith('d1')) return 'Швейцария 🇨🇭';
    if (code.startsWith('d2')) return 'Швеция 🇸🇪';
    if (code) return code.toUpperCase();
    return inactive ? 'Не активна' : 'Авто';
  };

  const API_BASES = window.location.hostname.endsWith('github.io')
    ? ['https://nexusray.cc/nexus/api/']
    : ['/nexus/api/'];

  async function api(path, options = {}) {
    const headers = {
      'X-Telegram-Init-Data': initData,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };
    const timeoutMs = options.timeoutMs || 14000;
    let lastError = null;
    for (const base of API_BASES) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(`${base}${path}`, {
          ...options,
          headers,
          signal: controller?.signal,
        });
        let data = {};
        try { data = await response.json(); } catch (_) {}
        if (!response.ok) {
          const err = new Error(data.message || data.error || 'Сервис временно недоступен');
          err.status = response.status;
          err.code = data.error || '';
          throw err;
        }
        return data;
      } catch (err) {
        if (err?.name === 'AbortError') {
          const tErr = new Error('Сервер отвечает слишком долго. Попробуйте ещё раз.');
          tErr.status = 0;
          tErr.code = 'timeout';
          lastError = tErr;
        } else {
          lastError = err;
        }
        if ((err instanceof TypeError || err?.name === 'AbortError') && API_BASES.length > 1) continue;
        throw lastError;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError || new Error('Сервис временно недоступен');
  }

  const sentEvents = new Set();
  function sendEvent(name, oncePerSession = false) {
    if (!initData || !name) return;
    if (oncePerSession && sentEvents.has(name)) return;
    sentEvents.add(name);
    api('event', { method: 'POST', body: JSON.stringify({ event: name }), timeoutMs: 5000 }).catch(() => {});
  }

  function pendingStorageKey() {
    return `nexus_pending_pay:${state?.viewer?.id || 0}`;
  }
  function savePendingPayment(pay) {
    pendingPayment = pay || null;
    try {
      if (pay) localStorage.setItem(pendingStorageKey(), JSON.stringify({ ...pay, saved_at: Date.now() }));
      else localStorage.removeItem(pendingStorageKey());
    } catch (_) {}
    renderPendingBanner();
  }
  function restorePendingPayment() {
    if (!state) return;
    const histPending = (state.payment_history || []).find((p) => p.status === 'pending' && p.payment_id);
    if (histPending) {
      pendingPayment = {
        payment_id: histPending.payment_id,
        amount: histPending.amount,
        confirmation_url: histPending.confirmation_url || pendingPayment?.confirmation_url || '',
      };
      renderPendingBanner();
      return;
    }
    try {
      const raw = localStorage.getItem(pendingStorageKey());
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.payment_id && Date.now() - (saved.saved_at || 0) < 30 * 60 * 1000) {
        pendingPayment = saved;
      } else {
        localStorage.removeItem(pendingStorageKey());
        pendingPayment = null;
      }
    } catch (_) {
      pendingPayment = null;
    }
    renderPendingBanner();
  }
  function renderPendingBanner() {
    const box = $('pending-payment');
    if (!box) return;
    if (!pendingPayment) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if ($('pending-amount')) $('pending-amount').textContent = `${pendingPayment.amount}\u00A0₽`;
    if ($('open-payment')) $('open-payment').hidden = !pendingPayment.confirmation_url;
  }

  const VIEW_INDEX = { home: 0, devices: 1, more: 2, plans: 3 };
  function go(view) {
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `${view}-view`));
    document.querySelectorAll('.bottom-nav button').forEach((el) => {
      const active = el.dataset.view === view;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    const nav = $('nav');
    if (nav && VIEW_INDEX[view] !== undefined) {
      nav.style.setProperty('--nav-idx', String(VIEW_INDEX[view]));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    hapticSelect();
    if (view === 'home' && state) {
      requestAnimationFrame(() => renderTrafficChart());
    } else if (view === 'plans' || view === 'devices') {
      sendEvent(`view:${view}`, true);
    }
  }

  let lastFocused = null;
  function resetSheetTransform() {
    const sheet = $('sheet');
    const backdrop = $('backdrop');
    if (sheet) {
      sheet.classList.remove('is-dragging');
      sheet.style.transform = '';
    }
    if (backdrop) backdrop.style.opacity = '';
  }

  function showSheetModal(focusTarget = null) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = $('sheet');
    const backdrop = $('backdrop');
    if ($('app')) $('app').inert = true;
    if ($('nav')) $('nav').inert = true;
    if (sheet) {
      sheet.inert = false;
      sheet.classList.add('open');
    }
    if (backdrop) backdrop.classList.add('open');
    if (focusTarget && focusTarget.tagName === 'INPUT') {
      setTimeout(() => {
        if (!sheet?.classList.contains('open')) return;
        focusTarget.focus();
        if (typeof focusTarget.select === 'function') focusTarget.select();
        focusTarget.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }, 280);
    } else if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus({ preventScroll: true });
    } else {
      sheet?.focus?.({ preventScroll: true });
    }
  }

  function openSheet(title, text, actions, field = false, initialValue = '', fieldLabel = 'Название устройства', fieldPlaceholder = 'Мой iPhone') {
    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">${esc(title)}</h2>
      <p>${esc(nbsp(text))}</p>
      ${field ? `<label class="field"><span>${esc(fieldLabel)}</span><input id="sheet-input" maxlength="32" autocomplete="off" autocorrect="off" enterkeyhint="done" placeholder="${esc(fieldPlaceholder)}"><div id="sheet-inline-error" class="sheet-inline-error" hidden></div></label>` : ''}
      <div class="sheet-actions">${actions.map((a) => `<button type="button" class="${a.class || ''}" data-sheet-action="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div>`;
    actions.forEach((action) => {
      const btn = $('sheet-content').querySelector(`[data-sheet-action="${action.id}"]`);
      if (btn) btn.onclick = () => action.run(field ? $('sheet-input').value : '');
    });
    const input = field ? $('sheet-input') : null;
    if (input) {
      input.value = initialValue || '';
      input.addEventListener('input', () => {
        const errEl = $('sheet-inline-error');
        if (errEl) errEl.hidden = true;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          $('sheet-content').querySelector('.sheet-actions button.primary')?.click();
        }
      });
    }
    showSheetModal(input || $('sheet-close'));
  }

  function closeSheet() {
    resetSheetTransform();
    document.documentElement.style.setProperty('--kb-offset', '0px');
    $('backdrop')?.classList.remove('open');
    const sheet = $('sheet');
    if (sheet) {
      sheet.classList.remove('open');
      sheet.inert = true;
    }
    if ($('app')) $('app').inert = false;
    if ($('nav')) $('nav').inert = false;
    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus?.({ preventScroll: true });
    }
    lastFocused = null;
  }

  function initVisualViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const syncKb = () => {
      const offset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb-offset', `${offset > 60 ? offset : 0}px`);
    };
    vv.addEventListener('resize', syncKb);
    vv.addEventListener('scroll', syncKb);
  }

  function initSheetDrag() {
    const zone = $('sheet-drag-zone');
    const sheet = $('sheet');
    const backdrop = $('backdrop');
    if (!zone || !sheet) return;
    let startY = 0, lastY = 0, lastTime = 0, instantVy = 0, currentDy = 0, dragging = false;

    const onStart = (clientY) => {
      if (!sheet.classList.contains('open')) return;
      startY = clientY; lastY = clientY; lastTime = performance.now();
      instantVy = 0; currentDy = 0; dragging = true;
      sheet.classList.add('is-dragging');
    };
    const onMove = (clientY) => {
      if (!dragging) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      instantVy = (clientY - lastY) / dt;
      lastY = clientY; lastTime = now;
      const rawDy = clientY - startY;
      currentDy = rawDy < 0 ? rawDy * 0.18 : rawDy;
      sheet.style.transform = `translate3d(-50%, ${currentDy}px, 0)`;
      if (backdrop && currentDy > 0) {
        const progress = Math.min(1, currentDy / 280);
        backdrop.style.opacity = String(Math.max(0.15, 1 - progress * 0.8));
      }
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('is-dragging');
      const projectedY = currentDy + instantVy * 160;
      if (instantVy >= -0.05 && (currentDy > 76 || (currentDy > 24 && (instantVy > 0.45 || projectedY > 96)))) {
        haptic('light');
        closeSheet();
      } else {
        sheet.style.transform = '';
        if (backdrop) backdrop.style.opacity = '';
      }
    };

    zone.addEventListener('touchstart', (e) => { if (e.touches.length === 1) onStart(e.touches[0].clientY); }, { passive: true });
    zone.addEventListener('touchmove', (e) => { if (dragging && e.touches.length === 1) onMove(e.touches[0].clientY); }, { passive: true });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  }

  async function runAction(path, body, options = {}) {
    const { refresh = true, progress = 'Выполняем…', notifySuccess = true, keepSheetOpen = false } = options;
    if (busy) return null;
    busy = true;
    if (!keepSheetOpen) closeSheet();
    $('activity-text').textContent = progress;
    $('activity').hidden = false;
    tg?.MainButton?.showProgress?.();
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      if (keepSheetOpen) closeSheet();
      if (notifySuccess) notify(result.message || 'Готово');
      tg?.HapticFeedback?.notificationOccurred?.('success');
      if (refresh) await load();
      return result;
    } catch (error) {
      notify(error.message || 'Не удалось выполнить действие');
      tg?.HapticFeedback?.notificationOccurred?.('error');
      return null;
    } finally {
      busy = false;
      $('activity').hidden = true;
      tg?.MainButton?.hideProgress?.();
    }
  }

  function showDeliveryResult(message) {
    openSheet('Готово — проверьте чат', `${message} Чтобы сразу увидеть новые сообщения, закройте Mini App.`, [
      { id: 'stay', label: 'Остаться', run: closeSheet },
      { id: 'chat', label: 'Открыть чат', class: 'primary', run: () => tg?.close?.() },
    ]);
  }

  function isTrialSubscription(sub) {
    if (typeof sub.is_trial === 'boolean') return sub.is_trial;
    const remSec = Math.max(0, (sub.expires_at || 0) - Date.now() / 1000);
    return sub.status === 'active' && (sub.device_limit || 1) === 1 && remSec > 0 && remSec <= 86400 && !(state?.payment_history || []).some((p) => p.status === 'applied');
  }

  function fmtFreezeBank(sub) {
    const hrs = Number.isFinite(sub.freeze_bank_hours) ? Math.max(0, Math.floor(sub.freeze_bank_hours)) : Math.max(0, (sub.freeze_bank_days || 0) * 24);
    const d = Math.floor(hrs / 24);
    const h = hrs % 24;
    if (hrs <= 0) return '0\u00A0дн.';
    if (d === 0) return `${h}\u00A0ч`;
    return h > 0 && d < 3 ? `${d}\u00A0дн. ${h}\u00A0ч` : `${d}\u00A0дн.`;
  }

  function fmtLastOnline(device, subStatus) {
    if (subStatus === 'frozen') return { text: 'На паузе', cls: 'paused', dot: 'waiting' };
    if (subStatus !== 'active') return { text: 'Отключён', cls: '', dot: 'offline' };
    if (device.online) return { text: 'Онлайн', cls: 'online', dot: '' };
    const ts = Number(device.last_online_at || 0);
    if (!ts) return { text: 'Готов к работе', cls: '', dot: '' };
    const diffMin = Math.max(1, Math.floor((Date.now() / 1000 - ts) / 60));
    if (diffMin < 60) return { text: `Был ${diffMin}\u00A0мин назад`, cls: '', dot: '' };
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return { text: `Был ${hourWord(diffH)} назад`, cls: '', dot: 'offline' };
    const diffD = Math.floor(diffH / 24);
    return { text: `Был ${diffD}\u00A0дн. назад`, cls: '', dot: 'offline' };
  }

  function renderHome() {
    const sub = state.subscription || {};
    const viewer = state.viewer || {};
    const familyMember = state.access_mode === 'family_member';
    const inactive = state.cabinet_mode === 'inactive';
    const isActive = sub.status === 'active';
    const isFrozen = sub.status === 'frozen';
    const isExpired = sub.status === 'expired';
    const isNone = sub.status === 'none' || sub.status === 'deleted' || sub.status === 'inactive';
    const isTrial = !familyMember && isTrialSubscription(sub);
    const sale = state.promotions?.global_sale;
    const pers = state.promotions?.personal_discount;
    const hasSale = Boolean(sale?.active && sale.percent > 0);
    const hasPers = Boolean(pers?.active && pers.value > 0);
    document.body.dataset.cabinetMode = state.cabinet_mode || 'inactive';

    const fortune = dailyFortune(viewer);
    $('viewer-name').textContent = fortune.greeting;
    if ($('barnum-text')) $('barnum-text').textContent = fortune.text;

    const nowSec = Math.floor(Date.now() / 1000);
    const remSec = isFrozen ? Math.max(0, sub.frozen_seconds || 0) : Math.max(0, (sub.expires_at || 0) - nowSec);
    const remHours = remSec > 0 ? Math.max(1, Math.ceil(remSec / 3600)) : 0;
    const effectiveDays = isFrozen ? Math.ceil(remSec / 86400) : (sub.remaining_days || 0);
    const lowDays = isActive && !isTrial && effectiveDays <= 7;
    const expiringSoon = isActive && !isTrial && effectiveDays <= 5;

    const pill = $('status-pill');
    const statusLabel = isTrial
      ? `Пробный · ${hourWord(remHours)}`
      : expiringSoon
        ? (remSec < 48 * 3600 ? `Истекает · ${hourWord(remHours)}` : `Истекает · ${effectiveDays}\u00A0дн.`)
        : (statusText[sub.status] || sub.status);
    if ($('sub-status')) $('sub-status').textContent = statusLabel;
    if (pill) {
      const pillCls = isTrial ? 'active' : `${sub.status}${expiringSoon ? ' expiring' : ''}`;
      pill.className = `status-pill ${pillCls}`;
    }

    const kindEl = $('subscription-kind');
    if (kindEl) {
      kindEl.textContent = familyMember
        ? `Семейный доступ · ${state.family_access?.owner_name || 'Семья'}`
        : isTrial
          ? 'Пробный доступ (24 ч)'
          : isNone
            ? 'Статус подписки'
            : isFrozen
              ? 'Подписка на паузе'
              : isExpired
                ? 'Срок действия истёк'
                : 'Остаток подписки';
    }

    const daysEl = $('sub-days');
    const daysLabelEl = $('sub-days-label');
    if (daysEl && daysLabelEl) {
      if (isActive && remSec > 0 && remSec < 48 * 3600) {
        daysEl.textContent = remHours;
        daysLabelEl.textContent = `${pluralRu(remHours, 'час остался', 'часа осталось', 'часов осталось')}`;
      } else if (isFrozen) {
        daysEl.textContent = effectiveDays;
        daysLabelEl.textContent = `${pluralRu(effectiveDays, 'день на паузе', 'дня на паузе', 'дней на паузе')}`;
      } else if (isNone) {
        daysEl.textContent = '0';
        daysLabelEl.textContent = 'нет активного плана';
      } else if (isExpired) {
        daysEl.textContent = '0';
        daysLabelEl.textContent = 'подписка истекла';
      } else {
        daysEl.textContent = effectiveDays;
        daysLabelEl.textContent = daysRemainingLabel(effectiveDays);
      }
    }

    const untilEl = $('sub-until');
    if (untilEl) {
      if (isFrozen) untilEl.textContent = 'На паузе';
      else if (isExpired && sub.expires_at) untilEl.textContent = `истекла ${fmtDate(sub.expires_at)}`;
      else if (isActive && sub.expires_at) untilEl.textContent = remSec < 48 * 3600 ? `до ${fmtDateTime(sub.expires_at)}` : `до ${fmtDate(sub.expires_at)}`;
      else untilEl.textContent = 'Не оплачена';
    }

    const graceNote = $('grace-note');
    if (graceNote) {
      const graceUntil = sub.grace_until || (isExpired && sub.expires_at ? sub.expires_at + 48 * 3600 : 0);
      const graceLeftH = graceUntil > nowSec ? Math.ceil((graceUntil - nowSec) / 3600) : 0;
      if (isExpired && graceLeftH > 0) {
        graceNote.hidden = false;
        graceNote.textContent = `Ваши ключи сохранены ещё ${hourWord(graceLeftH)} (до ${fmtDateTime(graceUntil)}). Продлите подписку — всё заработает без перенастройки.`;
      } else {
        graceNote.hidden = true;
      }
    }

    const protoEl = $('sub-protocol');
    if (protoEl) {
      protoEl.textContent = sub.protocol ? 'AWG' : '';
      protoEl.hidden = !sub.protocol;
    }

    const devEl = $('sub-devices');
    if (devEl) devEl.textContent = familyMember ? slotWord(sub.occupied_slots || 1) : `${sub.occupied_slots} / ${sub.device_limit}`;

    const nodeBtn = $('card-node-btn');
    const nodeEl = $('sub-node');
    const nodeWarnDot = $('node-warn-dot');
    const routeAlertEl = $('route-alert');
    const routes = Array.isArray(sub.routes) ? sub.routes : [];
    const primaryRoute = routes.find((r) => r.role === 'primary');
    const primaryDegraded = isActive && primaryRoute?.status === 'degraded';
    if (nodeEl) {
      nodeEl.textContent = primaryRoute
        ? `${primaryRoute.country} ${primaryRoute.flag || ''}`.trim()
        : nodeLabel(sub.server?.node, inactive);
    }
    if (nodeBtn) {
      nodeBtn.disabled = isNone && !routes.length;
      nodeBtn.classList.toggle('degraded', primaryDegraded);
    }
    if (nodeWarnDot) nodeWarnDot.hidden = !primaryDegraded;
    if (routeAlertEl) {
      if (primaryDegraded) {
        const healthyAlt = routes.find((r) => r.role !== 'primary' && r.status === 'ok')
          || routes.find((r) => r.role !== 'primary');
        const hint = healthyAlt
          ? `переключите тумблер на ${healthyAlt.country}`
          : 'проверьте резервные маршруты';
        routeAlertEl.hidden = false;
        routeAlertEl.innerHTML = `<span class="route-alert-left">${icon('alert')}<span>На основном маршруте (${esc(primaryRoute.country)}) просадка в РФ — ${esc(hint)}</span></span><em aria-hidden="true">›</em>`;
      } else {
        routeAlertEl.hidden = true;
      }
    }

    // Native direct ZIP download label on Telegram 8.0+
    const canDownload = supportsNativeDownload();
    if ($('quick-config-title')) $('quick-config-title').textContent = canDownload ? 'Скачать .zip' : 'Файлы в бот';
    if ($('quick-config-sub')) $('quick-config-sub').textContent = canDownload ? 'прямо на телефон' : '.conf в чат';

    // Free 24h Trial CTA (only for eligible new users)
    const trialCta = $('trial-cta');
    if (trialCta) {
      trialCta.hidden = !(sub.trial_available && inactive && !familyMember);
    }

    // Wide Payment CTA
    const purchase = $('purchase-cta');
    if (purchase) {
      purchase.hidden = false;
      const persUnit = hasPers ? (pers.type === 'rub' ? '\u00A0₽' : '%') : '';
      const maxDiscountPct = familyMember ? '−27%' : 'До −30%';
      const pTitle = $('purchase-cta-title');
      if (pTitle) {
        pTitle.textContent = familyMember
          ? 'Продлить семью'
          : isTrial
            ? 'Выбрать тариф'
            : lowDays
              ? 'Продлить сейчас'
              : ['active', 'frozen'].includes(sub.status)
                ? 'Купить время'
                : 'Подключить доступ';
      }
      const pSub = $('purchase-cta-sub');
      if (pSub) {
        pSub.textContent = hasSale
          ? 'Акция в тарифах · дни суммируются'
          : hasPers
            ? 'Ваша скидка активна · дни суммируются'
            : familyMember
              ? 'Общая подписка · единый баланс'
              : isTrial
                ? '1, 3 или 7 устройств · СБП в 1 клик'
                : ['active', 'frozen'].includes(sub.status)
                  ? 'СБП в 1 клик · дни суммируются'
                  : 'СБП в 1 клик · мгновенная выдача';
      }
      const badge = $('purchase-cta-badge');
      if (badge) {
        badge.textContent = hasSale
          ? `−${sale.percent}%`
          : hasPers
            ? `−${pers.value}${persUnit}`
            : lowDays
              ? 'Продлить'
              : maxDiscountPct;
      }
    }

    // Active Sale / Personal Discount Strip on Home
    const homePromo = $('home-promo');
    if (homePromo) {
      if (hasSale) {
        const dl = sale.expires_at ? `до ${fmtDateTime(sale.expires_at)}` : 'Открыть';
        homePromo.hidden = false;
        homePromo.innerHTML = `<span>🔥 Акция −${sale.percent}% на продление</span><em>${esc(dl)}</em>`;
      } else if (hasPers) {
        const unit = pers.type === 'rub' ? '₽' : '%';
        const dl = pers.expires_at ? `до ${fmtDateTime(pers.expires_at)}` : 'Открыть';
        homePromo.hidden = false;
        homePromo.innerHTML = `<span>🎁 Ваша персональная скидка −${pers.value}${unit}</span><em>${esc(dl)}</em>`;
      } else {
        homePromo.hidden = true;
      }
    }

    // Quick Connect Grid (ONLY for active 1-device or active family_member)
    const quickGrid = $('quick-connect-grid');
    const showQuickConnect = isActive && (familyMember || (sub.device_limit || 1) === 1);
    if (quickGrid) quickGrid.hidden = !showQuickConnect;
    if ($('quick-qr')) $('quick-qr').hidden = !showQuickConnect;
    if ($('quick-config')) $('quick-config').hidden = !showQuickConnect;

    // Onboarding vs Traffic Chart
    const showOnboarding = isNone && !familyMember;
    if ($('onboarding-card')) $('onboarding-card').hidden = !showOnboarding;
    if ($('traffic-card')) $('traffic-card').hidden = showOnboarding;

    // Adaptive Mini-Wallets (always 2 or 3 useful items, zero dead buttons, zero 1/3 holes!)
    const regenBtn = $('regen-action');
    const promoWallet = $('promo-wallet-action');
    const troubleWallet = $('troubleshoot-wallet-action');
    const freezeBtn = $('freeze-action');
    const bankHours = Number.isFinite(sub.freeze_bank_hours) ? sub.freeze_bank_hours : (sub.freeze_bank_days || 0) * 24;

    if (regenBtn) regenBtn.hidden = !isActive;
    if (promoWallet) promoWallet.hidden = !(isNone || isExpired);
    if (troubleWallet) troubleWallet.hidden = !(familyMember || isNone || isExpired || isTrial);
    if (freezeBtn) {
      const canShowFreeze = !familyMember && !isTrial && (isActive || isFrozen);
      freezeBtn.hidden = !canShowFreeze;
      freezeBtn.disabled = isActive && bankHours <= 0;
      freezeBtn.dataset.action = isFrozen ? 'unfreeze' : 'freeze';
      if ($('freeze-title')) $('freeze-title').textContent = isFrozen ? 'Разморозка' : 'Заморозка';
      if ($('freeze-hint')) $('freeze-hint').textContent = isFrozen ? 'Вернуть доступ' : 'Пауза дней';
      if ($('freeze-sub')) $('freeze-sub').textContent = isFrozen ? 'Вкл' : fmtFreezeBank(sub);
      const fIcon = freezeBtn.querySelector('.mini-wallet-icon');
      if (fIcon) fIcon.innerHTML = icon(isFrozen ? 'refresh' : 'snow');
    }

    if (!showOnboarding) renderTrafficChart();
  }

  let focusedSeriesIdx = null;
  let selectedDayIdx = 6;
  let chartModel = null;
  let chartEventsBound = false;

  function buildSmoothSplinePath(pts, minY = -Infinity, maxY = Infinity) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    const clampY = (val, lo, hi) => Math.max(minY, Math.min(maxY, Math.max(lo, Math.min(hi, val))));
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const segMin = Math.min(p1.y, p2.y);
      const segMax = Math.max(p1.y, p2.y);
      const flat = Math.abs(p1.y - p2.y) < 0.05;
      const cp1y = flat ? p1.y : clampY(p1.y + (p2.y - p0.y) / 6, segMin, segMax);
      const cp2y = flat ? p2.y : clampY(p2.y - (p3.y - p1.y) / 6, segMin, segMax);
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  function fmtTraffic(gb) {
    const v = Math.max(0, Number(gb) || 0);
    if (v < 0.0001) return '0\u00A0ГБ';
    if (v < 0.001) return '<1\u00A0МБ';
    if (v < 0.995) return `${Math.max(1, Math.round(v * 1024))}\u00A0МБ`;
    if (v < 10) return `${v.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}\u00A0ГБ`;
    return `${v.toFixed(1).replace(/\.0$/, '')}\u00A0ГБ`;
  }

  function fmtAxisTraffic(gb) {
    if (gb <= 0) return '0';
    if (gb < 0.995) return `${Math.max(1, Math.round(gb * 1024))}\u00A0МБ`;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1).replace(/\.0$/, '')}\u00A0ГБ`;
  }

  function pickNiceTrafficMax(maxVal) {
    if (maxVal <= 0) return 1;
    const target = maxVal * 1.18;
    const tiers = [
      10 / 1024, 20 / 1024, 50 / 1024, 100 / 1024, 200 / 1024, 500 / 1024,
      1, 2, 4, 6, 8, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500,
    ];
    for (const t of tiers) {
      if (t >= target) return t;
    }
    return Math.ceil(target / 100) * 100;
  }

  function updateTrafficSelectionInPlace() {
    if (!chartModel) return;
    const { series, days, dayLongLabels, inactive, subStatus, xAt, yAt } = chartModel;
    const subEl = $('traffic-sub');
    const totalPill = $('traffic-total-pill');
    const activeDayLabel = dayLongLabels[selectedDayIdx] || days[selectedDayIdx];
    const totalWeekAll = series.reduce((acc, s) => acc + s.total, 0);

    if (focusedSeriesIdx !== null && series[focusedSeriesIdx]) {
      const s = series[focusedSeriesIdx];
      if (subEl) subEl.textContent = `${s.name} · ${activeDayLabel}: ${fmtTraffic(s.values[selectedDayIdx])} (7\u00A0дн. — ${fmtTraffic(s.total)})`;
      if (totalPill) totalPill.textContent = fmtTraffic(s.total);
    } else {
      const daySum = series.reduce((acc, s) => acc + s.values[selectedDayIdx], 0);
      if (subEl) {
        if (subStatus === 'frozen') subEl.textContent = `Подписка на паузе · за 7 дней: ${fmtTraffic(totalWeekAll)}`;
        else if (inactive && totalWeekAll < 0.0001) subEl.textContent = 'Подписка неактивна · трафик не расходуется';
        else if (totalWeekAll < 0.0001) subEl.textContent = 'Учёт трафика активен · обновление каждые 5\u00A0мин';
        else if (series.length === 1) subEl.textContent = `За 7 дней · ${activeDayLabel}: ${fmtTraffic(daySum)}`;
        else subEl.textContent = `За 7 дней · ${activeDayLabel}: ${fmtTraffic(daySum)} (${series.length}\u00A0устр.)`;
      }
      if (totalPill) totalPill.textContent = fmtTraffic(totalWeekAll);
    }

    // Update legend values & focus classes IN-PLACE (preserves horizontal scrollLeft!)
    const legendEl = $('traffic-legend');
    if (legendEl) {
      legendEl.querySelectorAll('[data-series-idx]').forEach((btn) => {
        const idx = Number(btn.dataset.seriesIdx);
        const s = series[idx];
        if (!s) return;
        const isFocused = focusedSeriesIdx === idx;
        const isDimmed = focusedSeriesIdx !== null && focusedSeriesIdx !== idx;
        btn.classList.toggle('focused', isFocused);
        btn.classList.toggle('dimmed', isDimmed);
        btn.setAttribute('aria-pressed', String(isFocused));
        const valEl = btn.querySelector('.legend-val');
        if (valEl) valEl.textContent = fmtTraffic(s.values[selectedDayIdx]);
      });
    }

    // Update SVG cursor, active circles, series dimming, and day label highlight IN-PLACE (zero DOM teardown!)
    const box = $('traffic-chart-box');
    const svg = box?.querySelector('svg');
    if (svg) {
      const cx = xAt(selectedDayIdx).toFixed(1);
      const cursorLine = svg.querySelector('.traffic-cursor-line');
      if (cursorLine) {
        cursorLine.setAttribute('x1', cx);
        cursorLine.setAttribute('x2', cx);
      }
      svg.querySelectorAll('[data-series-group]').forEach((g) => {
        const idx = Number(g.dataset.seriesGroup);
        const s = series[idx];
        if (!s) return;
        g.classList.toggle('dimmed', focusedSeriesIdx !== null && focusedSeriesIdx !== idx);
        const dot = g.querySelector('.traffic-active-dot');
        if (dot) {
          dot.setAttribute('cx', cx);
          dot.setAttribute('cy', yAt(s.values[selectedDayIdx]).toFixed(1));
        }
      });
      svg.querySelectorAll('[data-day-idx]').forEach((t) => {
        t.classList.toggle('active', Number(t.dataset.dayIdx) === selectedDayIdx);
      });
    }
  }

  function bindChartScrubOnce() {
    if (chartEventsBound) return;
    const box = $('traffic-chart-box');
    if (!box) return;
    chartEventsBound = true;

    let startX = 0, startY = 0, axis = '', tracking = false;
    const pickDayAtClientX = (clientX) => {
      if (!chartModel) return;
      const rect = box.getBoundingClientRect();
      if (!rect.width) return;
      const relX = ((clientX - rect.left) / rect.width) * chartModel.W;
      const idx = Math.max(0, Math.min(6, Math.round(((relX - chartModel.padL) / chartModel.plotW) * 6)));
      if (idx !== selectedDayIdx) {
        selectedDayIdx = idx;
        hapticSelect();
        updateTrafficSelectionInPlace();
        sendEvent('traffic_interact', true);
      }
    };

    box.addEventListener('click', (e) => {
      const target = e.target.closest?.('[data-day-hit], [data-day-idx]');
      if (target) {
        const idx = Number(target.dataset.dayHit ?? target.dataset.dayIdx);
        if (idx !== selectedDayIdx) {
          selectedDayIdx = idx;
          hapticSelect();
          updateTrafficSelectionInPlace();
          sendEvent('traffic_interact', true);
        }
      }
    });

    box.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      axis = '';
      tracking = true;
    }, { passive: true });

    box.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      if (axis === 'x') pickDayAtClientX(e.touches[0].clientX);
    }, { passive: true });

    const endTouch = () => { tracking = false; axis = ''; };
    box.addEventListener('touchend', endTouch);
    box.addEventListener('touchcancel', endTouch);
  }

  function renderTrafficChart() {
    const card = $('traffic-card');
    if (!card || card.hidden || !state) return;
    const sub = state.subscription || {};
    const activeDevices = (state.devices || []).filter((d) => d.configured !== false && d.kind !== 'family_pending');
    const seriesList = activeDevices.length
      ? activeDevices.map((d, idx) => ({
          slot: d.slot || idx + 1,
          name: d.member_name || d.name || `Устройство ${d.slot || idx + 1}`,
          rawSeries: Array.isArray(d.traffic_daily_gb) ? d.traffic_daily_gb : null,
        }))
      : [{ slot: 1, name: 'Основное устройство', rawSeries: null }];

    const isDark = document.documentElement.dataset.theme === 'dark';
    const palette = isDark
      ? [
          { stroke: '#2dd4a8', fillTop: 'rgba(45, 212, 168, 0.30)', fillBottom: 'rgba(45, 212, 168, 0.0)' },
          { stroke: '#fb923c', fillTop: 'rgba(251, 146, 60, 0.26)', fillBottom: 'rgba(251, 146, 60, 0.0)' },
          { stroke: '#ece3d8', fillTop: 'rgba(236, 227, 216, 0.22)', fillBottom: 'rgba(236, 227, 216, 0.0)' },
          { stroke: '#818cf8', fillTop: 'rgba(129, 140, 248, 0.24)', fillBottom: 'rgba(129, 140, 248, 0.0)' },
          { stroke: '#fbbf24', fillTop: 'rgba(251, 191, 36, 0.22)', fillBottom: 'rgba(251, 191, 36, 0.0)' },
          { stroke: '#f472b6', fillTop: 'rgba(244, 114, 182, 0.22)', fillBottom: 'rgba(244, 114, 182, 0.0)' },
          { stroke: '#38bdf8', fillTop: 'rgba(56, 189, 248, 0.22)', fillBottom: 'rgba(56, 189, 248, 0.0)' },
        ]
      : [
          { stroke: '#0f9d7a', fillTop: 'rgba(15, 157, 122, 0.28)', fillBottom: 'rgba(15, 157, 122, 0.0)' },
          { stroke: '#ea580c', fillTop: 'rgba(234, 88, 12, 0.24)', fillBottom: 'rgba(234, 88, 12, 0.0)' },
          { stroke: '#191715', fillTop: 'rgba(25, 23, 21, 0.16)', fillBottom: 'rgba(25, 23, 21, 0.0)' },
          { stroke: '#6366f1', fillTop: 'rgba(99, 102, 241, 0.20)', fillBottom: 'rgba(99, 102, 241, 0.0)' },
          { stroke: '#d97706', fillTop: 'rgba(217, 119, 6, 0.20)', fillBottom: 'rgba(217, 119, 6, 0.0)' },
          { stroke: '#db2777', fillTop: 'rgba(219, 39, 119, 0.18)', fillBottom: 'rgba(219, 39, 119, 0.0)' },
          { stroke: '#0284c7', fillTop: 'rgba(2, 132, 199, 0.18)', fillBottom: 'rgba(2, 132, 199, 0.0)' },
        ];

    const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const serverDays = Array.isArray(state.traffic_days) && state.traffic_days.length === 7 ? state.traffic_days : null;
    const now = new Date();
    const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const serverMatchesLocalToday = !serverDays || serverDays[6] === localTodayStr;

    const days = Array.from({ length: 7 }, (_, i) => {
      if (i === 6 && serverMatchesLocalToday) return 'Сег';
      if (serverDays) {
        const parts = String(serverDays[i] || '').split('-').map(Number);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
          return dayNames[dt.getUTCDay()];
        }
      }
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
      return i === 6 ? 'Сег' : dayNames[dt.getDay()];
    });

    const dayLongLabels = days.map((lbl, i) => {
      if (serverMatchesLocalToday) {
        if (i === 6) return 'Сегодня';
        if (i === 5) return 'Вчера';
      }
      if (serverDays && serverDays[i]) {
        const parts = String(serverDays[i]).split('-');
        if (parts.length === 3) return `${parts[2]}.${parts[1]} (${lbl})`;
      }
      return lbl;
    });

    const inactive = state.cabinet_mode === 'inactive' || sub.status === 'none';
    const series = seriesList.map((item, idx) => {
      const color = palette[idx % palette.length];
      // Preserve real 7-day history even if subscription recently expired!
      const values = item.rawSeries && item.rawSeries.length === 7
        ? item.rawSeries.map((v) => Math.max(0, Number(v) || 0))
        : [0, 0, 0, 0, 0, 0, 0];
      const total = values.reduce((acc, v) => acc + v, 0);
      return { ...item, color, values, total };
    });

    if (focusedSeriesIdx !== null && focusedSeriesIdx >= series.length) focusedSeriesIdx = null;
    if (series.length <= 1) focusedSeriesIdx = null;

    if ($('traffic-title')) {
      $('traffic-title').textContent = series.length > 1 ? 'Трафик по устройствам' : 'Трафик устройства';
    }

    const maxVal = Math.max(0, ...series.flatMap((s) => s.values));
    const niceMax = pickNiceTrafficMax(maxVal);

    const box = $('traffic-chart-box');
    const rect = box?.getBoundingClientRect();
    if (!rect || rect.width < 10) return;
    const W = Math.max(240, Math.round(rect.width));
    const H = Math.max(88, Math.round(rect.height || 132));
    const padL = 12;
    const padR = 14;
    const padT = 10;
    const padB = 18;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const baselineY = padT + plotH;

    const xAt = (i) => padL + (plotW * i) / 6;
    const yAt = (v) => padT + plotH - (Math.min(niceMax, Math.max(0, v)) / niceMax) * plotH;

    chartModel = { series, days, dayLongLabels, inactive, subStatus: sub.status, W, H, padL, plotW, xAt, yAt };

    const legendEl = $('traffic-legend');
    if (legendEl) {
      const prevScroll = legendEl.scrollLeft;
      const single = series.length <= 1;
      legendEl.innerHTML = series.map((s, idx) => {
        const isFocused = focusedSeriesIdx === idx;
        const isDimmed = focusedSeriesIdx !== null && focusedSeriesIdx !== idx;
        return `<button type="button" class="legend-chip${isFocused ? ' focused' : ''}${isDimmed ? ' dimmed' : ''}" data-series-idx="${idx}" aria-pressed="${isFocused}"${single ? ' tabindex="-1"' : ''}>
          <i class="legend-dot" style="background:${s.color.stroke}"></i>
          <span class="legend-name">${esc(s.name)}</span>
          <b class="legend-val">${fmtTraffic(s.values[selectedDayIdx])}</b>
        </button>`;
      }).join('');
      legendEl.scrollLeft = prevScroll;
      legendEl.classList.toggle('is-scrollable', legendEl.scrollWidth > legendEl.clientWidth + 6);

      if (!single) {
        legendEl.querySelectorAll('[data-series-idx]').forEach((btn) => {
          btn.onclick = () => {
            const idx = Number(btn.dataset.seriesIdx);
            focusedSeriesIdx = focusedSeriesIdx === idx ? null : idx;
            hapticSelect();
            updateTrafficSelectionInPlace();
            sendEvent('traffic_interact', true);
          };
        });
      }
    }

    const defs = series.map((s, idx) => `
      <linearGradient id="tgrad-${idx}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.color.fillTop}"/>
        <stop offset="100%" stop-color="${s.color.fillBottom}"/>
      </linearGradient>
    `).join('');

    const gridValues = [0, niceMax / 2, niceMax];
    const gridLines = gridValues.map((gv) => {
      const y = yAt(gv).toFixed(1);
      const labelY = gv === 0 ? (Number(y) - 3).toFixed(1) : (Number(y) + 9).toFixed(1);
      return `
        <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="traffic-grid-line"/>
        <text x="${padL + 2}" y="${labelY}" class="traffic-axis-label">${fmtAxisTraffic(gv)}</text>
      `;
    }).join('');

    const pathsHtml = series.map((s, idx) => {
      const pts = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
      const linePath = buildSmoothSplinePath(pts, padT, baselineY);
      const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
      const isDimmed = focusedSeriesIdx !== null && focusedSeriesIdx !== idx;
      const activePt = pts[selectedDayIdx] || pts[pts.length - 1];
      return `
        <g class="traffic-series-group${isDimmed ? ' dimmed' : ''}" data-series-group="${idx}">
          <path d="${areaPath}" fill="url(#tgrad-${idx})" stroke="none"/>
          <path d="${linePath}" fill="none" stroke="${s.color.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle class="traffic-active-dot" cx="${activePt.x.toFixed(1)}" cy="${activePt.y.toFixed(1)}" r="3.6" fill="${s.color.stroke}" stroke="#ffffff" stroke-width="1.6"/>
        </g>
      `;
    }).join('');

    const cursorX = xAt(selectedDayIdx).toFixed(1);
    const dayLabelsHtml = days.map((dLabel, i) => {
      const x = xAt(i).toFixed(1);
      return `<text x="${x}" y="${H - 3}" class="traffic-axis-day${i === selectedDayIdx ? ' active' : ''}" data-day-idx="${i}">${dLabel}</text>`;
    }).join('');

    const hitRectsHtml = days.map((_, i) => {
      const step = plotW / 6;
      const x = Math.max(0, xAt(i) - step / 2);
      const w = i === 0 || i === 6 ? step / 2 + padR : step;
      return `<rect x="${x.toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${plotH + padB}" fill="transparent" stroke="none" style="cursor:pointer" data-day-hit="${i}"/>`;
    }).join('');

    box.innerHTML = `
      <svg class="traffic-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="График трафика по дням">
        <defs>${defs}</defs>
        ${gridLines}
        <line x1="${cursorX}" y1="${padT}" x2="${cursorX}" y2="${baselineY}" class="traffic-cursor-line"/>
        ${pathsHtml}
        ${dayLabelsHtml}
        ${hitRectsHtml}
      </svg>
    `;
    bindChartScrubOnce();
    updateTrafficSelectionInPlace();
  }

  function renderDeviceMetaHtml(device, subStatus) {
    const pills = [];
    const st = fmtLastOnline(device, subStatus);
    pills.push(`<span class="device-meta-pill${st.cls ? ` ${st.cls}` : ''}">${esc(st.text)}</span>`);
    const hasSplit = Number.isFinite(device.traffic_up_gb_7d) && Number.isFinite(device.traffic_down_gb_7d);
    const total7d = Array.isArray(device.traffic_daily_gb) ? device.traffic_daily_gb.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    if (hasSplit && (device.traffic_up_gb_7d > 0 || device.traffic_down_gb_7d > 0)) {
      pills.push(`<span class="device-meta-pill">7\u00A0дн.: \u2191\u00A0${fmtTraffic(device.traffic_up_gb_7d)} · \u2193\u00A0${fmtTraffic(device.traffic_down_gb_7d)}</span>`);
    } else if (total7d > 0) {
      pills.push(`<span class="device-meta-pill">За 7\u00A0дн.: ${fmtTraffic(total7d)}</span>`);
    }
    return `<div class="device-meta-row">${pills.join('')}</div>`;
  }

  function deviceCard(slot, device) {
    const sub = state.subscription || {};
    const isSubActive = sub.status === 'active';
    const isOwnerFamilyPlan = state.access_mode !== 'family_member' && (sub.device_limit || 1) === 7;

    if (!device) {
      const dis = isSubActive ? '' : ' disabled';
      return `<article class="device-card empty">
        <div class="device-top">
          <div class="device-icon" aria-hidden="true">${icon('plus')}</div>
          <div class="device-copy"><small>Место ${slot}</small><strong>Свободное место</strong><span>${isOwnerFamilyPlan ? 'Для своего устройства или участника семьи' : 'Создайте отдельный ключ подключения'}</span></div>
        </div>
        <div class="empty-slot-actions">
          <button type="button" class="add-device" data-device="add" data-slot="${slot}"${dis}>+ Моё устройство</button>
          ${isOwnerFamilyPlan ? `<button type="button" class="add-device family-invite" data-device="invite-family" data-slot="${slot}"${dis}>Пригласить в семью</button>` : ''}
        </div>
      </article>`;
    }

    if (device.kind === 'family_member') {
      const active = isSubActive && device.configured;
      const unavailable = active ? '' : ' disabled';
      const note = active
        ? 'Это только ваш ключ. Владелец семьи не может его скачать или перевыпустить.'
        : sub.status === 'frozen'
          ? 'Владелец временно заморозил семейную подписку. Ваше место сохранено.'
          : isSubActive
            ? 'Ключ временно восстанавливается. Попробуйте немного позже.'
            : 'Подписка владельца сейчас неактивна. Ваше место пока сохранено.';
      const st = fmtLastOnline(device, sub.status);
      return `<article class="device-card family member">
        <div class="device-top">
          <div class="device-icon" aria-hidden="true">${icon('family')}</div>
          <div class="device-copy"><small>Семейное место ${device.slot}</small><strong>${esc(device.name)}</strong><span>Владелец: ${esc(device.owner_name)}</span></div>
          <i class="device-state${active ? (st.dot ? ` ${st.dot}` : '') : ' waiting'}" role="img" aria-label="${active ? st.text : 'Ожидает'}"></i>
        </div>
        ${renderDeviceMetaHtml(device, sub.status)}
        <div class="device-note">${note}</div>
        <div class="device-buttons">
          <button type="button" class="accent" data-device="family-qr" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('qr')} Большой QR</button>
          <button type="button" class="accent" data-device="family-get" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('download')} Файлы в бот</button>
          <button type="button" data-device="family-rename" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('edit')} Имя</button>
          <button type="button" data-device="family-regenerate" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('refresh')} Сброс</button>
          <button type="button" class="danger" data-device="family-leave" data-slot="${device.slot}" data-owner="${device.owner_id}">Выйти</button>
        </div>
      </article>`;
    }

    if (device.kind === 'family') {
      const st = fmtLastOnline(device, sub.status);
      return `<article class="device-card family">
        <div class="device-top">
          <div class="device-icon" aria-hidden="true">${icon('family')}</div>
          <div class="device-copy"><small>Место ${device.slot} · Семья</small><strong>${esc(device.member_name || device.name)}</strong><span>Отдельный ключ участника</span></div>
          <i class="device-state${st.dot ? ` ${st.dot}` : ''}" role="img" aria-label="${esc(st.text)}"></i>
        </div>
        ${renderDeviceMetaHtml(device, sub.status)}
        <div class="device-note">Файл и перевыпуск доступны только самому участнику. При отзыве участник сохранит 12\u00A0ч на переход.</div>
        <button type="button" class="family-danger" data-device="revoke-family" data-slot="${device.slot}">Отозвать доступ</button>
      </article>`;
    }

    if (device.kind === 'family_pending') {
      const isProcessing = device.invite_status === 'processing';
      const expText = device.invite_expires_at ? `Действует до ${fmtDateTime(device.invite_expires_at)}` : 'Ожидает принятия участником';
      return `<article class="device-card family pending">
        <div class="device-top">
          <div class="device-icon" aria-hidden="true">${icon('shield')}</div>
          <div class="device-copy"><small>Место ${device.slot} · Семья</small><strong>${isProcessing ? 'Приглашение принимается…' : 'Приглашение отправлено'}</strong><span>${esc(expText)}</span></div>
          <i class="device-state waiting" role="img" aria-label="Ожидает"></i>
        </div>
        ${device.invite_url && !isProcessing ? `<div class="empty-slot-actions"><button type="button" class="add-device family-invite" data-share-invite="${esc(device.invite_url)}">Поделиться</button><button type="button" class="add-device" data-copy-invite="${esc(device.invite_url)}">Копировать</button></div>` : ''}
        <button type="button" class="family-danger" data-device="cancel-invite" data-slot="${device.slot}"${isProcessing ? ' disabled' : ''}>${isProcessing ? 'Подключается…' : 'Отменить приглашение'}</button>
      </article>`;
    }

    const st = fmtLastOnline(device, sub.status);
    const dis = isSubActive ? '' : ' disabled';
    return `<article class="device-card">
      <div class="device-top">
        <div class="device-icon" aria-hidden="true">${icon('phone')}</div>
        <div class="device-copy"><small>Место ${device.slot}</small><strong>${esc(device.name)}</strong><span>3 маршрута · основной, резерв и доп.</span></div>
        <i class="device-state${st.dot ? ` ${st.dot}` : ''}" role="img" aria-label="${esc(st.text)}"></i>
      </div>
      ${renderDeviceMetaHtml(device, sub.status)}
      <div class="device-buttons">
        <button type="button" class="accent" data-device="qr" data-slot="${device.slot}"${dis}>${icon('qr')} Большой QR</button>
        <button type="button" class="accent" data-device="get" data-slot="${device.slot}"${dis}>${icon('download')} Файлы в бот</button>
        <button type="button" data-device="rename" data-slot="${device.slot}"${dis}>${icon('edit')} Имя</button>
        <button type="button" data-device="regenerate" data-slot="${device.slot}"${dis}>${icon('refresh')} Сброс</button>
        <button type="button" class="danger" data-device="delete" data-slot="${device.slot}"${device.slot === 1 || !isSubActive ? ' disabled' : ''}>${icon('trash')} Удалить</button>
      </div>
    </article>`;
  }

  function renderDevices() {
    const sub = state.subscription || {};
    const list = $('devices-list');
    const summary = $('devices-summary');
    const slotPill = $('devices-pill');
    const slotBar = $('devices-progress');
    const banner = $('devices-status-banner');

    if (banner) {
      if (sub.status === 'frozen') {
        banner.hidden = false;
        banner.textContent = '❄️ Подписка на паузе. Разморозьте её на Главной, чтобы скачивать ключи и управлять устройствами.';
      } else if (sub.status === 'expired') {
        banner.hidden = false;
        banner.textContent = '⏳ Подписка истекла. Продлите доступ в разделе «Купить», чтобы ключи снова заработали без перенастройки.';
      } else {
        banner.hidden = true;
      }
    }

    if (state.access_mode === 'family_member') {
      const cnt = state.devices.length || 1;
      if (summary) summary.textContent = `Семейный доступ · ${state.family_access?.owner_name || 'Семья'}`;
      if (slotPill) slotPill.textContent = `${cnt} / ${cnt} ${pluralRu(cnt, 'место', 'места', 'мест')}`;
      if (slotBar) slotBar.style.width = '100%';
      if (list) list.innerHTML = state.devices.map((device) => deviceCard(device.slot, device)).join('');
      return;
    }

    const familyCount = (state.family?.members || 0) + (state.family?.pending || 0);
    if (summary) summary.textContent = `Занято ${sub.occupied_slots} из ${sub.device_limit}${familyCount ? ` · семейных: ${familyCount}` : ''}`;
    if (slotPill) slotPill.textContent = `${sub.occupied_slots} / ${sub.device_limit}`;
    if (slotBar) {
      const pct = sub.device_limit > 0 ? Math.min(100, Math.round((sub.occupied_slots / sub.device_limit) * 100)) : 0;
      slotBar.style.width = `${pct}%`;
    }

    if (state.cabinet_mode === 'inactive' && !state.devices.length) {
      if (list) {
        list.innerHTML = `<article class="device-card empty">
          <div class="device-top">
            <div class="device-icon" aria-hidden="true">${icon('shield')}</div>
            <div class="device-copy"><small>Подписка не активна</small><strong>Нет активных устройств</strong><span>Оформите подписку или активируйте 24\u00A0ч тест, чтобы получить ключи</span></div>
          </div>
          <div class="empty-slot-actions">
            ${sub.trial_available ? '<button type="button" class="add-device family-invite" data-action="trial">Тест 24\u00A0ч</button>' : ''}
            <button type="button" class="add-device" data-go-plans>Выбрать тариф</button>
          </div>
        </article>`;
      }
      return;
    }

    const map = new Map(state.devices.map((d) => [d.slot, d]));
    if (list) list.innerHTML = Array.from({ length: sub.device_limit }, (_, i) => deviceCard(i + 1, map.get(i + 1))).join('');
  }

  function renderPlans() {
    const sub = state.subscription || {};
    const current = sub.device_limit || 1;
    const familyMember = state.access_mode === 'family_member';
    const familyLimit = state.family_access?.plan_limit || 7;
    const hasActiveSub = !familyMember && ['active', 'frozen'].includes(sub.status);
    const isTrial = !familyMember && isTrialSubscription(sub);

    if (familyMember) selectedDevices = familyLimit;
    else if (![1, 3, 7].includes(selectedDevices)) {
      selectedDevices = [1, 3, 7].includes(sub.remembered_device_limit) ? sub.remembered_device_limit : current;
    }

    const sale = state.promotions?.global_sale;
    const pers = state.promotions?.personal_discount;
    const hasSale = Boolean(sale?.active && sale.percent > 0);
    const hasPers = Boolean(pers?.active && pers.value > 0);
    const banner = $('promo-banner');
    if (banner) {
      if (hasSale) {
        const sm = Array.isArray(sale.months) ? sale.months : [];
        const monthsList = !sm.length || sm.length === 4 ? 'на все периоды' : `на ${sm.join(' / ')} мес.`;
        const deadline = sale.expires_at ? `До ${fmtDateTime(sale.expires_at)}` : 'Акция';
        banner.hidden = false;
        banner.className = 'promo-banner';
        banner.innerHTML = `<div class="promo-top"><span class="promo-tag">Акция −${sale.percent}%</span><span class="promo-deadline">${esc(deadline)}</span></div><h3>Скидка −${sale.percent}% ${esc(monthsList)}</h3><p>Цены ниже уже пересчитаны со скидкой — при продлении дни суммируются.</p>`;
      } else if (hasPers) {
        const unit = pers.type === 'rub' ? '₽' : '%';
        const deadline = pers.expires_at ? `До ${fmtDateTime(pers.expires_at)}` : 'Бонус';
        banner.hidden = false;
        banner.className = 'promo-banner';
        banner.innerHTML = `<div class="promo-top"><span class="promo-tag">Скидка −${pers.value}${unit}</span><span class="promo-deadline">${esc(deadline)}</span></div><h3>Персональная цена активирована</h3><p>Скидка учтена в карточках тарифов и спишется только после оплаты.</p>`;
      } else {
        banner.hidden = true;
      }
    }

    const selector = $('device-limit-selector');
    const limits = [1, 3, 7];
    const segIdx = Math.max(0, limits.indexOf(selectedDevices));
    selector.classList.toggle('single', familyMember);
    selector.style.setProperty('--seg-idx', String(segIdx));
    selector.innerHTML = familyMember
      ? `<div class="seg-pill" aria-hidden="true"></div><button type="button" class="active" aria-pressed="true" disabled>${deviceWord(familyLimit)} · вся семья</button>`
      : `<div class="seg-pill" aria-hidden="true"></div>` + limits.map((n) => {
          const isCurrentBadge = hasActiveSub && n === current && !isTrial;
          return `<button type="button" data-limit="${n}" aria-pressed="${n === selectedDevices}" class="${n === selectedDevices ? 'active' : ''}">${isCurrentBadge ? `${n} · сейчас` : `${n}\u00A0устр.`}</button>`;
        }).join('');

    // Trial users on 24h test can directly purchase 1 / 3 / 7 devices without forced change_plan!
    const changing = hasActiveSub && !isTrial && selectedDevices !== current;
    const context = $('plan-change-box');
    const familyHint = $('plan-family-hint');
    const captionEl = $('plans-subtitle');
    const listEl = $('plans-list');
    const selectedOption = state.plan_change?.[String(selectedDevices)] || { allowed: true, reason: '', affected: [] };
    const blockedByFamily = Boolean(
      selectedOption.blocked_by_family ?? (selectedOption.reason && /семейн/i.test(selectedOption.reason))
    );
    const affectedSlots = Array.isArray(selectedOption.affected) ? selectedOption.affected : [];
    const expiredDowngradeConfirm = !hasActiveSub && !familyMember && !blockedByFamily && (selectedOption.needs_confirm || (!selectedOption.allowed && affectedSlots.length > 0));

    const renderFamilyHint = (show) => {
      if (!familyHint) return;
      if (!show) { familyHint.hidden = true; return; }
      const p12 = state.plans?.find((p) => p.months === 12)?.prices?.find((p) => p.devices === 7);
      const perDev = p12 ? Math.max(1, Math.round(p12.amount / 12 / 7)) : 83;
      familyHint.hidden = false;
      familyHint.innerHTML = `<span class="plan-family-hint-icon" aria-hidden="true">${icon('family')}</span><div><strong>Семья и друзья · от ≈${perDev}\u00A0₽/мес. за устройство</strong><span>Подключите свои гаджеты и выдайте до 6 отдельных приватных ключей близким прямо из «Устройств».</span></div>`;
    };

    if (changing) {
      renderFamilyHint(selectedDevices === 7 && !familyMember && sub.status !== 'frozen');
      const frozen = sub.status === 'frozen';
      const oldItem = state.plans?.find((p) => p.months === 1)?.prices?.find((p) => p.devices === current);
      const newItem = state.plans?.find((p) => p.months === 1)?.prices?.find((p) => p.devices === selectedDevices);
      const oldPrice = oldItem?.base_amount || oldItem?.amount || 299;
      const newPrice = newItem?.base_amount || newItem?.amount || 299;
      const seconds = frozen ? (sub.frozen_seconds || 0) : Math.max(0, (sub.expires_at || 0) - Date.now() / 1000);
      const newSec = Math.max(60, Math.round(seconds * oldPrice / newPrice));
      const newDays = Math.max(1, Math.ceil(newSec / 86400));
      const newUntil = fmtDate(Math.floor(Date.now() / 1000) + newSec);
      const blocked = frozen ? 'Сначала разморозьте подписку.' : selectedOption.reason;
      context.hidden = false;
      context.className = `plan-context${blocked ? ' blocked' : ''}`;
      context.innerHTML = `<small>Изменение текущего тарифа</small><h2>${current} → ${deviceWord(selectedDevices)}</h2><p>Это не покупка: деньги не списываются. Остаток пересчитается по стоимости тарифа — примерно <b>${newDays}\u00A0дн.</b>${!frozen ? ` (до ${esc(newUntil)})` : ''}.</p>${blocked ? `<div class="plan-warning">${esc(blocked)}</div>` : '<div class="plan-safe">Ни один ключ не будет удалён автоматически.</div>'}<button type="button" data-change-plan ${blocked ? 'disabled' : ''}>Изменить лимит</button>${blocked && !frozen ? '<button type="button" class="add-device" data-go-devices style="margin-top:8px">Перейти к устройствам</button>' : ''}`;
      if (captionEl) captionEl.textContent = 'Смена лимита отделена от покупки времени.';
      if (listEl) listEl.innerHTML = '';
      return;
    }

    if (!selectedOption.allowed && !expiredDowngradeConfirm) {
      renderFamilyHint(false);
      context.hidden = false;
      context.className = 'plan-context blocked';
      context.innerHTML = blockedByFamily
        ? `<small>Тариф недоступен</small><h2>${deviceWord(selectedDevices)}</h2><p>Семейные места принадлежат другим пользователям и не могут исчезнуть при покупке.</p><div class="plan-warning">${esc(selectedOption.reason)}</div><button type="button" class="add-device" data-go-devices style="margin-top:8px">Открыть устройства</button>`
        : `<small>Тариф временно недоступен</small><h2>${deviceWord(selectedDevices)}</h2><div class="plan-warning">${esc(selectedOption.reason || 'Сначала освободите лишние места.')}</div>`;
      if (captionEl) captionEl.textContent = blockedByFamily ? 'Сначала освободите семейные места.' : 'Сначала освободите лишние места.';
      if (listEl) listEl.innerHTML = '';
      return;
    }

    if (expiredDowngradeConfirm) {
      const names = affectedSlots.map((a) => `место ${a.slot} (${a.name})`).join(', ');
      context.hidden = false;
      context.className = 'plan-context blocked';
      context.innerHTML = `<small>Понижение тарифа при продлении</small><h2>Переход на ${deviceWord(selectedDevices)}</h2><p>При оплате этого тарифа лишние устройства будут отключены: <b>${esc(names || 'слоты выше лимита')}</b>.</p><div class="plan-warning">Если хотите сохранить все устройства, выберите прежний тариф.</div>`;
      if (captionEl) captionEl.textContent = 'Выберите срок — лишние места будут отключены после оплаты.';
    } else if (familyMember) {
      context.hidden = false;
      context.className = 'plan-context family-switch';
      context.innerHTML = `<small>Общая семейная подписка</small><h2>Оплата для всей семьи</h2><p>Дни будут начислены подписке владельца <b>${esc(state.family_access?.owner_name || 'Семья')}</b> и автоматически продлят доступ всех участников.</p><div class="plan-safe">Если позже выйти из семьи, уже оплаченные дни останутся у семейной подписки. Личный тариф покупается только после выхода.</div>`;
      if (captionEl) captionEl.textContent = 'Выберите срок продления общей подписки.';
    } else if (isTrial) {
      context.hidden = false;
      context.className = 'plan-context';
      context.innerHTML = `<small>Переход с пробного доступа</small><h2>Выберите любой тариф</h2><p>Вы можете сразу оплатить ${deviceWord(selectedDevices)} — оставшиеся часы теста добавятся к подписке.</p>`;
      if (captionEl) captionEl.textContent = 'Оплата по СБП в 1 клик или картой.';
    } else {
      context.hidden = true;
      if (captionEl) captionEl.textContent = hasActiveSub ? 'Дни суммируются с текущим остатком.' : 'Выберите количество устройств и период.';
    }

    renderFamilyHint(selectedDevices === 7 && !familyMember && !expiredDowngradeConfirm);

    const defaultPct = { 1: 0, 3: 8, 6: 17, 12: 27 };
    if (listEl) {
      listEl.innerHTML = (state.plans || []).map((plan) => {
        const item = plan.prices?.find((p) => p.devices === selectedDevices);
        if (!item) return '';
        const baseAmount = item.base_amount || item.amount;
        const hasDiscount = item.amount < baseAmount;
        const monthlyTotal = item.monthly_total || baseAmount;
        const totalSaved = Math.max(0, monthlyTotal - item.amount);
        const computedPct = plan.months > 1 && monthlyTotal > baseAmount
          ? Math.round((1 - baseAmount / monthlyTotal) * 100)
          : (defaultPct[plan.months] || 0);
        const tierLabel = plan.months === 1
          ? 'Базовый'
          : plan.months === 3
            ? `Популярный${computedPct > 0 ? ` · −${computedPct}%` : ''}`
            : plan.months === 6
              ? `Выгода${computedPct > 0 ? ` −${computedPct}%` : ''}`
              : `Максимум выгоды${computedPct > 0 ? ` −${computedPct}%` : ''}`;
        const perMonth = Math.max(1, Math.round(item.amount / plan.months));
        const featured = plan.months === 12;
        const popular = plan.months === 3;
        const badges = [`<span class="plan-pill">${esc(tierLabel)}</span>`];
        if (item.discount_label) badges.push(`<span class="plan-pill sale">${esc(item.discount_label)}</span>`);
        else if (totalSaved > 0 && (plan.months > 1 || hasDiscount)) badges.push(`<span class="plan-pill save">Экономия ${totalSaved}\u00A0₽</span>`);
        return `<article class="plan-card ${featured ? 'featured' : popular ? 'popular' : ''} ${hasDiscount ? 'sale-active' : ''}"><div><div class="plan-badges">${badges.join('')}</div><strong>${monthWord(plan.months)}</strong><div class="price-row"><strong>${item.amount}\u00A0₽</strong>${hasDiscount ? `<s>${baseAmount}\u00A0₽</s>` : ''}</div><div class="plan-meta">${selectedDevices}\u00A0устр. · ≈${perMonth}\u00A0₽/мес.</div></div><button type="button" data-buy="${plan.months}" data-confirm-downgrade="${expiredDowngradeConfirm ? '1' : ''}" ${!state.payments_enabled ? 'disabled' : ''}>${hasDiscount ? 'Забрать' : 'Выбрать'}</button></article>`;
      }).join('');
    }
  }

  function renderMore() {
    const sub = state.subscription || {};
    const viewer = state.viewer || {};
    const familyMember = state.access_mode === 'family_member';
    const uname = viewer.username ? ` · @${viewer.username}` : '';
    $('profile-id').textContent = `Telegram ID ${viewer.id}${uname}`;

    $('metric-one-label').textContent = familyMember ? 'Доступ' : 'Заморозка';
    $('metric-one-icon').innerHTML = icon(familyMember ? 'family' : 'snow');
    $('freeze-bank').textContent = familyMember ? 'Семья' : (sub.status === 'none' ? '—' : fmtFreezeBank(sub));

    const ref = state.referral || {};
    $('referral-count').textContent = ref.invited ?? 0;
    if ($('profile-referral-sub')) {
      $('profile-referral-sub').textContent = ref.bonus_days
        ? `Начислено +${ref.bonus_days}\u00A0дн. · приглашено ${ref.invited || 0}`
        : 'Подарите другу 24\u00A0ч и получите +7 дней';
    }

    const famTotal = (state.family?.members || 0) + (state.family?.pending || 0);
    if ($('metric-three-label')) $('metric-three-label').textContent = familyMember ? 'Владелец' : 'Семья';
    $('family-count').textContent = familyMember
      ? (state.family_access?.owner_name || 'Семья')
      : famTotal
        ? `${famTotal}\u00A0${pluralRu(famTotal, 'место', 'места', 'мест')}`
        : 'Нет';

    // Autorenew & Unbind payment method rows (only for personal subscribers)
    const arRow = $('autorenew-row');
    const arToggle = $('autorenew-toggle');
    const unbindBtn = $('unbind-method-btn');
    if (arRow && arToggle) {
      if (!familyMember && sub.autorenew && typeof sub.autorenew.enabled === 'boolean') {
        arRow.hidden = false;
        arToggle.setAttribute('aria-checked', String(sub.autorenew.enabled));
        if ($('autorenew-sub')) {
          $('autorenew-sub').textContent = sub.autorenew.enabled
            ? (sub.autorenew.method_title ? `Активно · ${sub.autorenew.method_title}` : 'Включено · привяжется при оплате')
            : (sub.autorenew.method_title ? `Выключено (${sub.autorenew.method_title})` : 'Выключено');
        }
      } else {
        arRow.hidden = true;
      }
    }
    if (unbindBtn) {
      const canUnbind = Boolean(!familyMember && sub.autorenew?.has_method);
      unbindBtn.hidden = !canUnbind;
      if (canUnbind && $('unbind-method-sub')) {
        $('unbind-method-sub').textContent = sub.autorenew.method_title
          ? `Удалить ${sub.autorenew.method_title} и выключить автосписание`
          : 'Удалить сохранённый способ оплаты';
      }
    }
    applyTheme(themePref, false);

    const rows = state.payment_history || [];
    $('payment-history').innerHTML = rows.length
      ? rows.map((p) => {
          const isFam = p.purpose === 'family_topup';
          const isDetach = p.purpose === 'family_detach';
          const title = isFam
            ? `Вся семья · ${monthWord(p.months)} · ${p.devices}\u00A0устр.`
            : isDetach
              ? `Личная подписка · ${monthWord(p.months)} · ${p.devices}\u00A0устр.`
              : `${monthWord(p.months)} · ${p.devices}\u00A0устр.`;
          const source = isFam && p.payer_id && p.payer_id !== viewer.id ? ' · оплатил участник' : '';
          const tags = [];
          if (p.method_title) tags.push(`<span class="history-tag">${esc(p.method_title)}</span>`);
          if (p.auto_renewal) tags.push('<span class="history-tag auto">Авто</span>');
          if (p.status === 'canceled' && p.cancel_reason) tags.push(`<span class="history-tag warn">${esc(p.cancel_reason)}</span>`);
          const needSupport = p.status === 'manual_review' || p.status === 'failed';
          return `<article class="history-row">
            <span class="history-icon" aria-hidden="true">₽</span>
            <div>
              <b>${title}</b>
              <small>${fmtDate(p.applied_at || p.created_at)} · ${esc(paymentText[p.status] || p.status)}${source}</small>
              ${tags.length ? `<div class="history-meta">${tags.join('')}</div>` : ''}
              ${needSupport ? '<button type="button" class="history-support-btn" data-open-support>Написать в поддержку</button>' : ''}
            </div>
            <strong>${p.amount}\u00A0₽</strong>
          </article>`;
        }).join('')
      : '<div class="empty-history">Платежей пока нет</div>';
  }

  function render() {
    renderHome();
    renderDevices();
    renderPlans();
    renderMore();
    restorePendingPayment();
    bindDynamic();
  }

  function bindDynamic() {
    document.querySelectorAll('[data-limit]').forEach((b) => {
      b.onclick = () => {
        const nextLimit = Number(b.dataset.limit);
        if (nextLimit === selectedDevices) return;
        selectedDevices = nextLimit;
        hapticSelect();
        renderPlans();
        bindDynamic();
      };
    });
    document.querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = () => startPurchase(Number(b.dataset.buy), b.dataset.confirmDowngrade === '1');
    });
    const changePlan = document.querySelector('[data-change-plan]');
    if (changePlan) changePlan.onclick = confirmPlanChange;
    document.querySelectorAll('[data-device]').forEach((b) => {
      b.onclick = () => devicePrompt(b.dataset.device, Number(b.dataset.slot), Number(b.dataset.owner || 0));
    });
    document.querySelectorAll('[data-go-plans]').forEach((b) => { b.onclick = () => go('plans'); });
    document.querySelectorAll('[data-go-devices]').forEach((b) => { b.onclick = () => go('devices'); });
    document.querySelectorAll('[data-action="trial"]').forEach((b) => { b.onclick = activateTrial; });
    document.querySelectorAll('[data-share-invite]').forEach((b) => {
      b.onclick = () => shareTelegramLink(b.dataset.shareInvite, 'Приглашаю тебя в семейный доступ neXus Ray! Нажми на ссылку, чтобы подключиться:');
    });
    document.querySelectorAll('[data-copy-invite]').forEach((b) => {
      b.onclick = () => copyText(b.dataset.copyInvite, 'Ссылка приглашения скопирована');
    });
    document.querySelectorAll('[data-open-support]').forEach((b) => {
      b.onclick = () => openSupport();
    });
  }

  function shareTelegramLink(url, text) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    openTgUrl(shareUrl);
  }

  function openSupport() {
    sendEvent('support', true);
    if (state?.support_url) openTgUrl(state.support_url);
  }

  function openRoutesSheet() {
    if (!state) return;
    sendEvent('routes', true);
    const sub = state.subscription || {};
    const routes = Array.isArray(sub.routes) && sub.routes.length
      ? sub.routes
      : sub.server?.node
        ? [{ role: 'primary', title: 'Основной маршрут', country: nodeLabel(sub.server.node, false), flag: '', node: String(sub.server.node).toUpperCase(), filename: '', status: 'ok', status_label: 'Активен' }]
        : [];
    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">Ваши маршруты</h2>
      <p>У каждого устройства есть 3 независимых страны. Если в сети просадка — просто переключите тумблер на другую страну в приложении.</p>
      <div class="route-list">
        ${routes.length
          ? routes.map((r) => `
            <div class="route-item">
              <div class="route-item-copy">
                <strong>${esc(r.flag ? `${r.flag} ${r.country}` : r.country)}</strong>
                <small>${esc(r.title)}${r.filename ? ` · ${esc(r.filename)}` : ''}</small>
              </div>
              <span class="route-status-badge ${esc(r.status || 'unknown')}">${esc(r.status_label || 'Проверяется')}</span>
            </div>`).join('')
          : '<div class="empty-history">Маршруты появятся сразу после активации подписки.</div>'}
      </div>
      <div class="sheet-actions">
        <button type="button" id="routes-trouble">Не работает?</button>
        <button type="button" class="primary" id="routes-close">Понятно</button>
      </div>`;
    $('routes-trouble').onclick = openTroubleshootSheet;
    $('routes-close').onclick = closeSheet;
    showSheetModal($('routes-close'));
  }

  function openTroubleshootSheet() {
    sendEvent('troubleshoot', true);
    const routes = state?.subscription?.routes || [];
    const altRoute = routes.find((r) => r.role === 'edge' && r.status === 'ok') || routes.find((r) => r.role === 'reserve');
    const altHint = altRoute ? `Попробуйте включить <b>${esc(altRoute.country)}</b> (${esc(altRoute.filename || altRoute.title)}).` : 'Попробуйте переключить тумблер на резервную или доп. страну.';
    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">Быстрая диагностика</h2>
      <p>Чаще всего доступ восстанавливается за 15 секунд — проверьте 4 пункта:</p>
      <div class="guide-steps">
        <div class="guide-step"><b>1</b><div><b>Включён только один тумблер.</b> Два активных маршрута одновременно мешают друг другу.</div></div>
        <div class="guide-step"><b>2</b><div><b>Смените страну.</b> ${altHint}</div></div>
        <div class="guide-step"><b>3</b><div><b>Переключите сеть</b> (Wi-Fi ↔ мобильная сеть или авиарежим на 5 секунд).</div></div>
        <div class="guide-step"><b>4</b><div><b>Обновите ключи.</b> Если давно не обновляли — нажмите «Сброс» на карточке устройства (старый ключ продолжит работать ещё 30\u00A0мин).</div></div>
      </div>
      <div class="sheet-actions">
        <button type="button" id="tr-support">Написать в поддержку</button>
        <button type="button" class="primary" id="tr-close">Закрыть</button>
      </div>`;
    $('tr-support').onclick = () => { closeSheet(); openSupport(); };
    $('tr-close').onclick = closeSheet;
    showSheetModal($('tr-close'));
  }

  async function requestInstaller(platform) {
    const r = await runAction('installer', { platform }, { refresh: false, progress: 'Отправляем установщик EX WG 1.0…', notifySuccess: false });
    if (r) showDeliveryResult(r.message || 'Установщик EX WG 1.0 отправлен в чат с ботом.');
  }

  function openGuideSheet(initialOs = null) {
    sendEvent('guide', true);
    let currentOs = initialOs || detectOs();
    const installers = state?.installers || {};
    const multiDevice = (state?.subscription?.device_limit || 1) > 1;
    const whereButtons = multiDevice ? 'во вкладке <b>«Устройства»</b>' : 'на <b>Главной</b> или во вкладке <b>«Устройства»</b>';

    const osData = {
      ios: {
        label: 'iPhone',
        installer: null,
        steps: [
          'Установите бесплатное приложение <b>AmneziaWG</b> из App Store по кнопке ниже.',
          `Нажмите <b>«Файлы в бот»</b> (${whereButtons}) — бот пришлёт архив <code>neXusRay.zip</code>.`,
          'Нажмите на файл → <b>«Поделиться»</b> → <b>AmneziaWG</b> → <b>«Разрешить»</b>. Включайте по одному тумблеру.',
        ],
        links: [{ label: 'App Store · AmneziaWG', url: 'https://apps.apple.com/app/amneziawg/id6478942365' }],
      },
      android: {
        label: 'Android',
        installer: installers.android !== false ? { platform: 'android', title: 'EX WG 1.0 для Android', sub: 'Рекомендуемый APK · придёт прямо в чат' } : null,
        steps: [
          'Установите <b>EX WG 1.0</b> (кнопка выше) или <b>AmneziaWG</b> из Google Play / GitHub APK.',
          `Нажмите <b>«Файлы в бот»</b> (${whereButtons}) и сохраните <code>neXusRay.zip</code> (или отсканируйте «Большой QR»).`,
          'В приложении нажмите <b>«+»</b> → <b>«Импорт из файла»</b> и выберите скачанный архив. Включайте по одному тумблеру.',
        ],
        links: [
          { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=org.amnezia.awg' },
          { label: 'GitHub APK', url: 'https://github.com/amnezia-vpn/amneziawg-android/releases/latest' },
        ],
      },
      windows: {
        label: 'Windows',
        installer: installers.windows !== false ? { platform: 'windows', title: 'EX WG 1.0 для Windows', sub: 'Установщик .exe · придёт прямо в чат' } : null,
        steps: [
          'Установите <b>EX WG 1.0</b> (кнопка выше) или официальный клиент <b>AmneziaWG</b> для Windows.',
          `Нажмите <b>«Файлы в бот»</b> (${whereButtons}) и сохраните архив <code>neXusRay.zip</code> на компьютер.`,
          'В программе нажмите <b>«Импорт туннелей из файла»</b> и выберите архив. Включайте один маршрут.',
        ],
        links: [{ label: 'GitHub · AmneziaWG', url: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest' }],
      },
      macos: {
        label: 'macOS',
        installer: null,
        steps: [
          'Установите официальное приложение <b>AmneziaWG</b> из App Store по кнопке ниже.',
          `Нажмите <b>«Файлы в бот»</b> (${whereButtons}) и сохраните <code>neXusRay.zip</code> в «Загрузки».`,
          'В AmneziaWG выберите <b>«Импорт из файла»</b> → укажите архив → включите один из 3 маршрутов.',
        ],
        links: [{ label: 'App Store · macOS', url: 'https://apps.apple.com/app/amneziawg/id6478942365' }],
      },
    };

    const renderGuideBody = () => {
      const cfg = osData[currentOs] || osData.ios;
      $('sheet-content').innerHTML = `
        <h2 id="sheet-title">Инструкция подключения</h2>
        <div class="os-tabs" role="tablist" aria-label="Выбор устройства">
          ${Object.entries(osData).map(([k, v]) => `<button type="button" role="tab" aria-selected="${k === currentOs}" class="${k === currentOs ? 'active' : ''}" data-os-tab="${k}">${v.label}</button>`).join('')}
        </div>
        ${cfg.installer ? `<div class="installer-banner"><div><strong>${esc(cfg.installer.title)}</strong><small>${esc(cfg.installer.sub)}</small></div><button type="button" data-send-installer="${cfg.installer.platform}">Получить</button></div>` : ''}
        <div class="guide-steps">
          ${cfg.steps.map((s, i) => `<div class="guide-step"><b>${i + 1}</b><div>${s}</div></div>`).join('')}
        </div>
        <div class="app-links" style="${cfg.links.length === 1 ? 'grid-template-columns:1fr' : ''}">
          ${cfg.links.map((l) => `<button type="button" data-app-url="${esc(l.url)}">${esc(l.label)}</button>`).join('')}
        </div>
        <div class="sheet-actions">
          <button type="button" id="guide-trouble">Не работает?</button>
          <button type="button" class="primary" id="guide-close">Понятно</button>
        </div>`;

      $('sheet-content').querySelectorAll('[data-os-tab]').forEach((b) => {
        b.onclick = () => {
          currentOs = b.dataset.osTab;
          hapticSelect();
          renderGuideBody();
        };
      });
      $('sheet-content').querySelectorAll('[data-app-url]').forEach((b) => {
        b.onclick = () => openExternal(b.dataset.appUrl);
      });
      $('sheet-content').querySelectorAll('[data-send-installer]').forEach((b) => {
        b.onclick = () => requestInstaller(b.dataset.sendInstaller);
      });
      $('guide-trouble').onclick = openTroubleshootSheet;
      $('guide-close').onclick = closeSheet;
    };

    resetSheetTransform();
    renderGuideBody();
    showSheetModal($('guide-close'));
  }

  function openReferralSheet() {
    const ref = state?.referral || {};
    const link = ref.link || `https://t.me/nexus_rayt_bot?start=${state?.viewer?.id || ''}`;
    const shareText = ref.share_text || 'Дарю 24 часа быстрого защищённого доступа neXus Ray! Подключайся по ссылке:';
    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">Пригласить друга</h2>
      <p>Друг получит <b>24 часа бесплатно</b>, а после его первой оплаты вам автоматически начислятся <b>+7 дней</b>.</p>
      <div class="referral-stats-grid">
        <div><b>${ref.invited ?? 0}</b><small>Приглашено</small></div>
        <div><b>${ref.rewarded ?? 0}</b><small>Оплатили</small></div>
        <div><b>+${ref.bonus_days ?? 0}\u00A0дн.</b><small>Бонус</small></div>
      </div>
      <div class="referral-link-box">
        <code>${esc(link)}</code>
        <button type="button" id="ref-copy-btn">Копировать</button>
      </div>
      <div class="sheet-actions">
        <button type="button" id="ref-close">Закрыть</button>
        <button type="button" class="primary" id="ref-share-btn">Подарить 24\u00A0ч</button>
      </div>`;
    $('ref-copy-btn').onclick = () => {
      sendEvent('referral_share', true);
      copyText(link, 'Реферальная ссылка скопирована');
    };
    $('ref-share-btn').onclick = () => {
      sendEvent('referral_share', true);
      shareTelegramLink(link, shareText);
    };
    $('ref-close').onclick = closeSheet;
    showSheetModal($('ref-share-btn'));
  }

  function openFreezeInfoSheet() {
    const sub = state?.subscription || {};
    if (state?.access_mode === 'family_member') {
      openSheet('Семейный доступ', `Вы пользуетесь общей подпиской владельца ${state.family_access?.owner_name || 'Семья'}. Заморозкой управляет владелец.`, [
        { id: 'ok', label: 'Понятно', class: 'primary', run: closeSheet },
      ]);
      return;
    }
    const resetText = sub.freeze_cycle_reset_at ? ` Банк обновляется до 30 дней ${fmtDate(sub.freeze_cycle_reset_at)}.` : ' Лимит: до 30 дней раз в 180 дней.';
    openSheet(
      'Банк заморозки',
      `Осталось ${fmtFreezeBank(sub)} паузы.${resetText} Во время заморозки дни не списываются, а доступ приостанавливается.`,
      [
        { id: 'close', label: 'Закрыть', run: closeSheet },
        ...(sub.status === 'active' || sub.status === 'frozen'
          ? [{ id: 'go', label: sub.status === 'frozen' ? 'Разморозить' : 'Заморозить', class: 'primary', run: () => promptFreeze(sub.status === 'frozen' ? 'unfreeze' : 'freeze') }]
          : []),
      ]
    );
  }

  function openPromoSheet() {
    openSheet(
      'Ввести промокод',
      'Промокод может добавить дни к подписке или активировать скидку на следующий платёж.',
      [
        { id: 'cancel', label: 'Отмена', run: closeSheet },
        {
          id: 'apply',
          label: 'Применить',
          class: 'primary',
          run: async (val) => {
            const code = String(val || '').trim();
            if (!code) {
              const errEl = $('sheet-inline-error');
              if (errEl) { errEl.textContent = 'Введите промокод'; errEl.hidden = false; }
              return;
            }
            await runAction('promo', { code }, { progress: 'Проверяем промокод…', keepSheetOpen: true });
          },
        },
      ],
      true,
      '',
      'Промокод',
      'Например, WELCOME20'
    );
  }

  async function activateTrial() {
    const r = await runAction('trial', {}, { progress: 'Активируем 24 часа бесплатно…', notifySuccess: false });
    if (r) {
      notify(r.message || 'Пробный доступ на 24 часа активирован!');
      openGuideSheet();
    }
  }

  async function downloadConfigZipDirect(slot, ownerId = 0) {
    if (!supportsNativeDownload()) {
      const act = ownerId ? 'family-get' : 'get';
      const r = await runAction('devices', { action: act, slot, owner_id: ownerId || undefined }, { progress: 'Отправляем архив в чат…', notifySuccess: false });
      if (r) showDeliveryResult(r.message);
      return;
    }
    setActivity('Готовим архив neXusRay.zip…');
    try {
      const r = await api('download-token', {
        method: 'POST',
        body: JSON.stringify({ slot, owner_id: ownerId || undefined }),
      });
      setActivity('');
      const url = r?.url || (r?.download_path ? `${API_BASES[0].replace(/\/nexus\/api\/?$/, '')}${r.download_path}` : '');
      if (!url) throw new Error('download_unavailable');
      tg.downloadFile({ url, file_name: r.file_name || 'neXusRay.zip' }, (accepted) => {
        if (accepted) {
          haptic('light');
          notify('Сохраняем neXusRay.zip — откройте его в AmneziaWG или EX WG');
        }
      });
    } catch (_) {
      setActivity('');
      // Graceful fallback to bot chat delivery if endpoint unavailable or download fails
      const act = ownerId ? 'family-get' : 'get';
      const r = await runAction('devices', { action: act, slot, owner_id: ownerId || undefined }, { progress: 'Отправляем архив в чат…', notifySuccess: false });
      if (r) showDeliveryResult(r.message);
    }
  }

  function confirmUnbindPaymentMethod() {
    const title = state?.subscription?.autorenew?.method_title || 'сохранённый способ оплаты';
    openSheet(
      'Отвязать способ оплаты?',
      `Мы удалим привязку (${title}) и выключим автопродление. Текущая подписка и оплаченные дни продолжат работать как обычно.`,
      [
        { id: 'cancel', label: 'Отмена', run: closeSheet },
        {
          id: 'unbind',
          label: 'Отвязать',
          class: 'danger',
          run: () => runAction('autorenew', { enabled: false, unbind: true }, { progress: 'Отвязываем способ оплаты…' }),
        },
      ]
    );
  }

  async function openQrModal(slot = 1, ownerId = 0, freshNotice = '') {
    const data = await runAction('qr', { slot, owner_id: ownerId || undefined }, { refresh: false, progress: 'Готовим большой QR-код…', notifySuccess: false });
    if (!data || !data.items?.length) return;
    let idx = 0;
    const items = data.items;
    const multi = items.length > 1;

    const qrTabLabel = (it, i) => {
      if (it.role === 'primary') return 'Основной';
      if (it.role === 'reserve') return 'Резерв';
      if (it.role === 'edge') return 'Доп.';
      return it.title || `Маршрут ${i + 1}`;
    };

    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">${esc(data.device_name || `Место ${slot}`)}</h2>
      ${freshNotice
        ? `<div class="qr-fresh-banner">✓ ${esc(freshNotice)}</div>`
        : `<p>${multi ? 'Переключайте маршруты свайпом или вкладками.' : 'Отсканируйте QR-код с другого экрана или отправьте файлы в бот.'}</p>`}
      <div class="qr-viewer" id="qr-swipe-area">
        <div class="qr-tabs ${multi ? '' : 'single'}" id="qr-tabs" role="tablist" aria-label="Маршрут" style="--qr-idx:0;--qr-count:${items.length}">
          <div class="qr-tab-pill" aria-hidden="true"></div>
          ${items.map((it, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-qr-tab="${i}" class="${i === 0 ? 'active' : ''}">${esc(qrTabLabel(it, i))}</button>`).join('')}
        </div>
        <div class="qr-carousel-viewport" id="qr-viewport">
          <div class="qr-carousel-track" id="qr-track">
            ${items.map((cur, i) => `
              <div class="qr-slide" ${i === 0 ? '' : 'inert aria-hidden="true"'}>
                <div class="qr-box">
                  <img src="${cur.qr_data_url}" alt="QR-код ${esc(cur.title)}: ${esc(cur.subtitle)}">
                  <div class="qr-route-bar">
                    ${multi ? `<button type="button" class="qr-arrow" data-qr-dir="-1" aria-label="Предыдущий маршрут" ${i === 0 ? 'disabled' : ''}>‹</button>` : '<span></span>'}
                    <div class="qr-route-copy">
                      <div class="qr-route-label">${esc(cur.title)}</div>
                      <div class="qr-route-sub">${esc(cur.subtitle)}</div>
                    </div>
                    ${multi ? `<button type="button" class="qr-arrow" data-qr-dir="1" aria-label="Следующий маршрут" ${i === items.length - 1 ? 'disabled' : ''}>›</button>` : '<span></span>'}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ${multi ? `<div class="qr-dots" id="qr-dots" aria-hidden="true">${items.map((_, i) => `<i class="${i === 0 ? 'active' : ''}"></i>`).join('')}</div>` : ''}
        <div class="qr-hint">Приложение <b>EX WG</b> или <b>AmneziaWG</b> → <b>«+»</b> → <b>Сканировать QR-код</b></div>
      </div>
      <div class="sheet-actions">
        <button type="button" id="qr-send-files">${supportsNativeDownload() ? 'Скачать .zip' : 'Архив в бот'}</button>
        <button type="button" class="primary" id="qr-done">Готово</button>
      </div>
      <div class="qr-separate-row">
        ${supportsNativeDownload() ? '<button type="button" class="qr-separate-btn" id="qr-send-bot">Архив в бот</button>' : ''}
        <button type="button" class="qr-separate-btn" id="qr-send-separate">Файлы .conf по отдельности</button>
      </div>`;

    const tabsEl = $('qr-tabs');
    const trackEl = $('qr-track');
    const viewportEl = $('qr-viewport');
    const dotsEl = $('qr-dots');

    const syncActiveSlide = (nextIdx, withHaptic = true) => {
      const clamped = Math.max(0, Math.min(items.length - 1, nextIdx));
      if (clamped !== idx && withHaptic) hapticSelect();
      idx = clamped;
      if (tabsEl) {
        tabsEl.style.setProperty('--qr-idx', String(idx));
        tabsEl.querySelectorAll('[data-qr-tab]').forEach((b, i) => {
          const active = i === idx;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
      }
      if (trackEl) {
        trackEl.classList.remove('is-dragging');
        trackEl.style.transform = `translate3d(${-idx * 100}%, 0, 0)`;
        trackEl.querySelectorAll('.qr-slide').forEach((slide, i) => {
          const active = i === idx;
          slide.inert = !active;
          if (active) slide.removeAttribute('aria-hidden');
          else slide.setAttribute('aria-hidden', 'true');
        });
      }
      if (dotsEl) dotsEl.querySelectorAll('i').forEach((d, i) => d.classList.toggle('active', i === idx));
    };

    $('sheet-content').querySelectorAll('[data-qr-tab]').forEach((b) => { b.onclick = () => syncActiveSlide(Number(b.dataset.qrTab), true); });
    $('sheet-content').querySelectorAll('[data-qr-dir]').forEach((b) => { b.onclick = () => syncActiveSlide(idx + Number(b.dataset.qrDir), true); });

    if (viewportEl && trackEl && multi) {
      let startX = 0, startY = 0, lastX = 0, lastTime = 0, instantVx = 0, currentDx = 0, swiping = false, lockedAxis = '';
      viewportEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY; lastX = startX; lastTime = performance.now();
        instantVx = 0; currentDx = 0; swiping = true; lockedAxis = '';
      }, { passive: true });
      viewportEl.addEventListener('touchmove', (e) => {
        if (!swiping || e.touches.length !== 1) return;
        const now = performance.now(), dt = Math.max(1, now - lastTime), clientX = e.touches[0].clientX;
        instantVx = (clientX - lastX) / dt; lastX = clientX; lastTime = now;
        const dx = clientX - startX, dy = e.touches[0].clientY - startY;
        if (!lockedAxis) {
          if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
          lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (lockedAxis === 'x') trackEl.classList.add('is-dragging');
        }
        if (lockedAxis !== 'x') return;
        const atEdge = (idx === 0 && dx > 0) || (idx === items.length - 1 && dx < 0);
        currentDx = atEdge ? dx * 0.34 : dx;
        trackEl.style.transform = `translate3d(calc(${-idx * 100}% + ${currentDx}px), 0, 0)`;
      }, { passive: true });
      const finishSwipe = () => {
        if (!swiping) return;
        swiping = false;
        if (lockedAxis !== 'x') return;
        const width = viewportEl.clientWidth || 300;
        let target = idx;
        if (instantVx <= 0.05 && (currentDx < -width * 0.18 || instantVx < -0.35)) target = Math.min(items.length - 1, idx + 1);
        else if (instantVx >= -0.05 && (currentDx > width * 0.18 || instantVx > 0.35)) target = Math.max(0, idx - 1);
        syncActiveSlide(target, true);
      };
      viewportEl.addEventListener('touchend', finishSwipe);
      viewportEl.addEventListener('touchcancel', finishSwipe);
    }

    const sendFiles = async (separate) => {
      const act = ownerId ? 'family-get' : 'get';
      const r = await runAction('devices', { action: act, slot, owner_id: ownerId || undefined, separate_files: separate || undefined }, { progress: separate ? 'Отправляем отдельные .conf…' : 'Отправляем архив в чат…', notifySuccess: false });
      if (r) showDeliveryResult(r.message);
    };

    $('qr-done').onclick = closeSheet;
    $('qr-send-files').onclick = () => (supportsNativeDownload() ? downloadConfigZipDirect(slot, ownerId) : sendFiles(false));
    if ($('qr-send-bot')) $('qr-send-bot').onclick = () => sendFiles(false);
    $('qr-send-separate').onclick = () => sendFiles(true);
    showSheetModal($('qr-done'));
  }

  function openQuickQr() {
    if (state?.subscription?.status !== 'active') {
      notify('Подписка не активна.');
      return;
    }
    if (state.access_mode === 'family_member') {
      const first = state.devices?.[0];
      if (first && state.devices.length === 1) { openQrModal(first.slot, first.owner_id); return; }
      go('devices'); notify('Выберите своё семейное место.'); return;
    }
    const own = (state.devices || []).filter((d) => !d.kind || d.kind === 'personal');
    if (own.length === 1) { openQrModal(own[0].slot, 0); return; }
    go('devices'); notify('Выберите устройство для показа большого QR.');
  }

  async function startPurchase(months, confirmDowngrade = false) {
    const sub = state.subscription || {};
    const current = sub.device_limit || 1;
    const familyMember = state.access_mode === 'family_member';
    const isTrial = !familyMember && isTrialSubscription(sub);
    const active = !familyMember && !isTrial && ['active', 'frozen'].includes(sub.status);
    if (active && selectedDevices !== current) {
      notify('Сначала примените изменение лимита.');
      return;
    }
    const plan = state.plans?.find((p) => p.months === months);
    const item = plan?.prices?.find((p) => p.devices === selectedDevices);
    if (!item) return;
    const price = item.amount, basePrice = item.base_amount || item.amount;
    const priceLine = price < basePrice
      ? `Стоимость со скидкой (${item.discount_label || 'акция'}): ${price}\u00A0₽ вместо ${basePrice}\u00A0₽.`
      : `К оплате: ${price}\u00A0₽.`;
    const familyWarning = familyMember
      ? ` Платёж продлит общую подписку владельца ${state.family_access?.owner_name || 'Семья'}; дни получат все участники и останутся у семьи даже после вашего выхода.`
      : '';
    const downgradeWarning = confirmDowngrade
      ? ' Внимание: личные устройства сверх выбранного лимита будут отключены после оплаты.'
      : '';

    const runCheckout = async (method) => {
      const r = await runAction(
        'payments',
        { months, devices: selectedDevices, method, confirm_downgrade: confirmDowngrade || undefined },
        { refresh: false, progress: method === 'sbp' ? 'Открываем оплату по СБП…' : 'Создаём безопасный счёт…', notifySuccess: false }
      );
      if (r) {
        savePendingPayment(r);
        openExternal(r.confirmation_url);
      }
    };

    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">${familyMember ? 'Продлить всю семью' : 'Оплата подписки'}</h2>
      <p>${esc(nbsp(`${monthWord(months)}, до ${deviceGenWord(selectedDevices)}. ${priceLine}${familyWarning}${downgradeWarning}`))}</p>
      <div class="sheet-pay-stack">
        <button type="button" class="sbp-primary" id="pay-sbp">Оплатить по СБП · ${price}\u00A0₽</button>
        <button type="button" id="pay-card">Карта / SberPay · ${price}\u00A0₽</button>
        <button type="button" class="cancel-link" id="pay-cancel">Отмена</button>
      </div>`;
    $('pay-sbp').onclick = () => runCheckout('sbp');
    $('pay-card').onclick = () => runCheckout('card');
    $('pay-cancel').onclick = closeSheet;
    showSheetModal($('pay-sbp'));
  }

  function confirmPlanChange() {
    const current = state.subscription.device_limit;
    openSheet(
      'Изменить лимит?',
      `Текущий тариф: ${deviceWord(current)}. Новый тариф: ${deviceWord(selectedDevices)}. Это не покупка — деньги не списываются, изменится остаток дней.`,
      [
        { id: 'cancel', label: 'Отмена', run: closeSheet },
        { id: 'go', label: 'Изменить лимит', class: 'primary', run: () => runAction('plan', { devices: selectedDevices, operation_id: operationId(), state_version: state.state_version }, { progress: 'Меняем лимит…' }) },
      ]
    );
  }

  function confirmRegenerate() {
    if (state?.subscription?.status !== 'active') {
      notify('Сброс ключа доступен только для активной подписки.');
      return;
    }
    if (state.access_mode === 'family_member') {
      const first = state.devices?.[0];
      if (first && state.devices.length === 1) { devicePrompt('family-regenerate', first.slot, first.owner_id); return; }
      go('devices'); notify('Выберите своё семейное место для перевыпуска.'); return;
    }
    const own = (state.devices || []).filter((d) => !d.kind || d.kind === 'personal');
    if (own.length === 1) { devicePrompt('regenerate', own[0].slot, 0); return; }
    go('devices'); notify('Выберите устройство для перевыпуска.');
  }

  function promptFreeze(action) {
    const sub = state?.subscription || {};
    const bankHours = Number.isFinite(sub.freeze_bank_hours) ? sub.freeze_bank_hours : (sub.freeze_bank_days || 0) * 24;
    if (action === 'freeze' && bankHours <= 0) {
      notify('Банк заморозки исчерпан.');
      return;
    }
    const hasFamily = (state.family?.members || 0) > 0;
    const freezeText = `Остаток банка паузы: ${fmtFreezeBank(sub)} (лимит 30 дн. / 180 дн., авто-разморозка по окончании). Дни перестанут расходоваться, а доступ временно приостановится.${hasFamily ? ' Семейные участники также будут временно приостановлены.' : ''}`;
    openSheet(
      action === 'freeze' ? 'Заморозить подписку?' : 'Разморозить подписку?',
      action === 'freeze' ? freezeText : 'Доступ снова включится, а сохранённые дни продолжат расходоваться.',
      [
        { id: 'cancel', label: 'Отмена', run: closeSheet },
        { id: 'go', label: action === 'freeze' ? 'Заморозить' : 'Разморозить', class: 'primary', run: () => runAction(action, { state_version: state.state_version }, { progress: action === 'freeze' ? 'Замораживаем подписку…' : 'Размораживаем подписку…' }) },
      ]
    );
  }

  function devicePrompt(action, slot, ownerId = 0) {
    if (action === 'qr' || action === 'family-qr') {
      openQrModal(slot, action === 'family-qr' ? ownerId : 0);
      return;
    }
    if (action === 'invite-family') {
      openSheet(
        'Пригласить в семью',
        `Мы создадим одноразовую ссылку для места ${slot}. Участник получит собственный ключ, а ваш тариф останется общим.`,
        [
          { id: 'cancel', label: 'Отмена', run: closeSheet },
          {
            id: 'go',
            label: 'Создать ссылку',
            class: 'primary',
            run: async () => {
              const r = await runAction('devices', { action: 'invite-family', slot }, { progress: 'Создаём приглашение…', notifySuccess: false });
              if (r?.invite_url) {
                resetSheetTransform();
                $('sheet-content').innerHTML = `
                  <h2 id="sheet-title">Приглашение готово</h2>
                  <p>Отправьте эту ссылку близкому человеку — после перехода бот сразу выдаст ему личный ключ.</p>
                  <div class="referral-link-box">
                    <code>${esc(r.invite_url)}</code>
                    <button type="button" id="inv-copy">Копировать</button>
                  </div>
                  <div class="sheet-actions">
                    <button type="button" id="inv-close">Закрыть</button>
                    <button type="button" class="primary" id="inv-share">Отправить в Telegram</button>
                  </div>`;
                $('inv-copy').onclick = () => copyText(r.invite_url, 'Ссылка приглашения скопирована');
                $('inv-share').onclick = () => shareTelegramLink(r.invite_url, 'Приглашаю тебя в семейный доступ neXus Ray! Нажми на ссылку для подключения:');
                $('inv-close').onclick = closeSheet;
                showSheetModal($('inv-share'));
              }
            },
          },
        ]
      );
      return;
    }

    const device = state.devices.find((item) => item.slot === slot);
    if (['add', 'rename', 'family-rename'].includes(action)) {
      openSheet(
        action === 'add' ? 'Новое устройство' : 'Переименовать устройство',
        'Укажите короткое понятное название — например, «iPhone» или «Ноутбук».',
        [
          { id: 'cancel', label: 'Отмена', run: closeSheet },
          {
            id: 'go',
            label: action === 'add' ? 'Создать' : 'Сохранить',
            class: 'primary',
            run: async (rawName) => {
              const name = String(rawName || '').trim();
              if (!name) {
                const errEl = $('sheet-inline-error');
                if (errEl) { errEl.textContent = 'Введите название устройства'; errEl.hidden = false; }
                return;
              }
              const createsConfig = action === 'add';
              const r = await runAction('devices', { action, slot, name, owner_id: ownerId || undefined }, { progress: createsConfig ? 'Создаём устройство и готовим QR…' : 'Сохраняем название…', notifySuccess: !createsConfig, keepSheetOpen: true });
              if (r && createsConfig) await openQrModal(slot, 0, 'Устройство создано · архив также отправлен в бот');
            },
          },
        ],
        true,
        action === 'add' ? '' : (device?.name || '')
      );
      return;
    }

    const labels = {
      get: ['Отправить файлы в бот', `Архив neXusRay.zip и QR для «${device?.name || `Место ${slot}`}» придут в чат с ботом.`, 'Отправить архив'],
      regenerate: ['Перевыпустить ключ?', `Новый QR сразу откроется здесь, а архив придёт в бот. Старый ключ «${device?.name || `Место ${slot}`}» продолжит работать ещё 30 минут, чтобы вы спокойно успели переключиться.`, 'Перевыпустить'],
      delete: ['Удалить устройство?', `Ключ «${device?.name || `Место ${slot}`}» перестанет работать на всех серверах.`, 'Удалить'],
      ['revoke-family']: ['Отозвать семейный доступ?', `Место ${slot} освободится сразу, а у участника «${device?.member_name || device?.name || `Место ${slot}`}» останется 12 часов на переход на личный тариф без обрыва связи.`, 'Отозвать'],
      ['cancel-invite']: ['Отменить приглашение?', 'Ссылка перестанет действовать, а место снова станет свободным.', 'Отменить приглашение'],
      ['family-get']: ['Получить семейные настройки', `Архив neXusRay.zip и QR для «${device?.name || `Место ${slot}`}» придут в ваш чат с ботом.`, 'Отправить архив'],
      ['family-regenerate']: ['Перевыпустить семейный ключ?', `Новый QR сразу откроется здесь, а файлы придут в бот. Прежний ключ продолжит работать ещё 30 минут.`, 'Перевыпустить'],
      ['family-leave']: ['Выйти из семьи?', 'Ваш ключ сразу перестанет работать, а уже оплаченные вами семейные дни останутся у общей подписки. После выхода личный тариф нужно купить отдельно.', 'Выйти из семьи'],
    };
    const [title, text, label] = labels[action];
    const isDanger = ['delete', 'regenerate', 'revoke-family', 'cancel-invite', 'family-regenerate', 'family-leave'].includes(action);
    const isGet = action === 'get' || action === 'family-get';
    if (isGet && supportsNativeDownload()) {
      resetSheetTransform();
      $('sheet-content').innerHTML = `
        <h2 id="sheet-title">Файлы подключения</h2>
        <p>Скачайте <b>neXusRay.zip</b> для «${esc(device?.name || `Место ${slot}`)}» прямо на телефон (удобно на iPhone) или отправьте файлы в чат с ботом.</p>
        <div class="sheet-pay-stack">
          <button type="button" class="sbp-primary" id="dl-direct-zip">Скачать neXusRay.zip</button>
          <button type="button" id="dl-bot-zip">Отправить архив в бот</button>
          <button type="button" id="dl-bot-sep">Отдельные .conf в бот</button>
          <button type="button" class="cancel-link" id="dl-cancel">Отмена</button>
        </div>`;
      $('dl-direct-zip').onclick = async () => { closeSheet(); await downloadConfigZipDirect(slot, ownerId); };
      $('dl-bot-zip').onclick = async () => {
        const r = await runAction('devices', { action, slot, owner_id: ownerId || undefined }, { progress: 'Отправляем архив в чат…', notifySuccess: false });
        if (r) showDeliveryResult(r.message);
      };
      $('dl-bot-sep').onclick = async () => {
        const r = await runAction('devices', { action, slot, owner_id: ownerId || undefined, separate_files: true }, { progress: 'Отправляем отдельные .conf…', notifySuccess: false });
        if (r) showDeliveryResult(r.message);
      };
      $('dl-cancel').onclick = closeSheet;
      showSheetModal($('dl-direct-zip'));
      return;
    }
    const actions = [
      { id: 'cancel', label: 'Отмена', run: closeSheet },
      ...(isGet ? [{
        id: 'sep',
        label: 'По отдельности',
        run: async () => {
          const r = await runAction('devices', { action, slot, owner_id: ownerId || undefined, separate_files: true }, { progress: 'Отправляем отдельные .conf…', notifySuccess: false });
          if (r) showDeliveryResult(r.message);
        },
      }] : []),
      {
        id: 'go',
        label,
        class: isDanger ? 'danger' : 'primary',
        run: async () => {
          const sendsConfig = ['get', 'regenerate', 'family-get', 'family-regenerate'].includes(action);
          const rotating = ['regenerate', 'family-regenerate'].includes(action);
          const r = await runAction('devices', {
            action,
            slot,
            owner_id: ownerId || undefined,
            operation_id: rotating ? operationId() : undefined,
            subject_id: action === 'revoke-family' ? device?.member_id : undefined,
            invite_version: action === 'cancel-invite' ? device?.invite_version : undefined,
            device_version: action === 'delete' ? device?.device_version : undefined,
          }, {
            progress: rotating ? 'Перевыпускаем ключ и готовим QR…' : sendsConfig ? 'Отправляем настройки в чат…' : 'Сохраняем изменения…',
            notifySuccess: !sendsConfig,
          });
          if (r) {
            if (rotating) await openQrModal(slot, action === 'family-regenerate' ? ownerId : 0, 'Ключ обновлён · прежний работает ещё 30 мин');
            else if (sendsConfig) showDeliveryResult(r.message);
          }
        },
      },
    ];
    openSheet(title, text, actions);
  }

  async function sendGlobalConfig() {
    if (state?.subscription?.status !== 'active') {
      notify('Подписка не активна.');
      return;
    }
    const own = (state.devices || []).filter((d) => !d.kind || d.kind === 'personal' || d.kind === 'family_member');
    if (own.length === 1) {
      const d = own[0];
      if (supportsNativeDownload()) {
        await downloadConfigZipDirect(d.slot, d.owner_id || 0);
        return;
      }
      const act = d.kind === 'family_member' ? 'family-get' : 'get';
      const r = await runAction('devices', { action: act, slot: d.slot, owner_id: d.owner_id || undefined }, { progress: 'Отправляем архив в чат…', notifySuccess: false });
      if (r) showDeliveryResult(r.message);
      return;
    }
    go('devices');
    notify(state.access_mode === 'family_member' ? 'Выберите своё семейное место.' : 'Выберите нужное устройство.');
  }

  function showLockedScreen(kind, message = '') {
    $('loading').hidden = true;
    $('content').hidden = true;
    $('nav').hidden = true;
    $('locked').hidden = false;
    const titleEl = $('locked-title');
    const textEl = $('locked-text');
    const actionsEl = $('locked-actions');
    const retryBtn = $('locked-retry');
    if (kind === 'forbidden') {
      if (titleEl) titleEl.textContent = 'Доступ ограничен';
      if (textEl) textEl.textContent = message || 'Вход в личный кабинет для этого аккаунта ограничен.';
      if (actionsEl) actionsEl.hidden = false;
      if (retryBtn) retryBtn.hidden = true;
    } else if (kind === 'network') {
      if (titleEl) titleEl.textContent = 'Нет связи с сервером';
      if (textEl) textEl.textContent = message || 'Не удалось загрузить кабинет. Проверьте подключение и нажмите «Повторить», либо используйте меню в чате бота.';
      if (actionsEl) actionsEl.hidden = false;
      if (retryBtn) retryBtn.hidden = false;
    } else {
      if (titleEl) titleEl.textContent = 'Откройте кабинет из Telegram-бота';
      if (textEl) textEl.textContent = 'Для защиты ключей и подписки приложение проверяет подпись Telegram при каждом входе.';
      if (actionsEl) actionsEl.hidden = true;
    }
  }

  async function load() {
    if (loadingInFlight) return;
    loadingInFlight = true;
    const refreshBtn = $('refresh');
    refreshBtn?.classList.add('is-spinning');
    try {
      const nextState = await api('me');
      const prevMode = lastAccessMode;
      state = nextState;
      lastAccessMode = state.access_mode;

      // Reset selectedDevices cleanly when exiting family_member -> personal!
      if (prevMode === 'family_member' && state.access_mode !== 'family_member') {
        selectedDevices = state.subscription?.remembered_device_limit || state.subscription?.device_limit || 1;
      } else if (!selectedDevices) {
        selectedDevices = state.access_mode === 'family_member'
          ? (state.family_access?.plan_limit || 7)
          : (state.subscription?.remembered_device_limit || state.subscription?.device_limit || 1);
      }

      $('loading').hidden = true;
      $('locked').hidden = true;
      $('content').hidden = false;
      $('nav').hidden = false;
      render();
      requestAnimationFrame(() => renderTrafficChart());
    } catch (error) {
      if (state) {
        // Keep existing UI alive on transient refresh errors!
        notify(error.message || 'Не удалось обновить данные');
      } else if (error?.status === 403) {
        showLockedScreen('forbidden', error.message);
      } else if (error?.status === 401 || error?.code === 'open_in_telegram') {
        showLockedScreen('auth');
      } else {
        showLockedScreen('network', error.message);
      }
    } finally {
      loadingInFlight = false;
      setTimeout(() => refreshBtn?.classList.remove('is-spinning'), 320);
    }
  }

  async function verifyPendingPayment(silent = false) {
    if (!pendingPayment || checkingPayment) return;
    checkingPayment = true;
    try {
      const r = silent
        ? await api('payments/check', { method: 'POST', body: JSON.stringify({ payment_id: pendingPayment.payment_id }) })
        : await runAction('payments/check', { payment_id: pendingPayment.payment_id }, { progress: 'Проверяем оплату…', refresh: false, notifySuccess: false });
      if (!r) return;
      if (r.status === 'applied') {
        clearTimeout(confirmedPollTimer);
        savePendingPayment(null);
        notify(r.message || 'Оплата применена, доступ готов!');
        await load();
      } else if (r.status === 'confirmed') {
        if (!silent) notify(r.message || 'Оплата подтверждена, начисляем дни…');
        clearTimeout(confirmedPollTimer);
        confirmedPollTimer = setTimeout(() => verifyPendingPayment(true), 2500);
      } else if (r.status === 'canceled') {
        savePendingPayment(null);
        notify(r.cancel_reason ? `Платёж отменён: ${r.cancel_reason}` : (r.message || 'Платёж отменён.'));
        await load();
      } else if (r.status === 'manual_review') {
        savePendingPayment(null);
        notify(r.message || 'Оплата подтверждена и ожидает проверки.');
        await load();
      } else if (!silent) {
        notify(r.message || 'Оплата пока не поступила.');
      }
    } catch (err) {
      if (!silent) notify(err.message || 'Проверка временно недоступна');
    } finally {
      checkingPayment = false;
    }
  }

  // Static listeners
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => go(b.dataset.view); });
  document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  document.querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = () => {
      const action = b.dataset.action;
      if (action === 'qr') openQuickQr();
      else if (action === 'guide') openGuideSheet();
      else if (action === 'configs') sendGlobalConfig();
      else if (action === 'regenerate') confirmRegenerate();
      else if (action === 'routes') openRoutesSheet();
      else if (action === 'troubleshoot') openTroubleshootSheet();
      else if (action === 'promo') openPromoSheet();
      else if (action === 'trial') activateTrial();
      else if (action === 'freeze' || action === 'unfreeze') promptFreeze(action);
    };
  });

  if ($('card-node-btn')) {
    $('card-node-btn').onclick = () => {
      if (!$('card-node-btn').disabled) openRoutesSheet();
    };
  }

  if ($('promo-apply-btn')) {
    $('promo-apply-btn').onclick = async () => {
      const input = $('promo-code-input');
      const code = String(input?.value || '').trim();
      if (!code) { notify('Введите промокод'); input?.focus(); return; }
      const r = await runAction('promo', { code }, { progress: 'Применяем промокод…' });
      if (r && input) input.value = '';
    };
  }
  if ($('promo-code-input')) {
    $('promo-code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('promo-apply-btn')?.click(); }
    });
  }

  if ($('autorenew-toggle')) {
    $('autorenew-toggle').onclick = async () => {
      const current = $('autorenew-toggle').getAttribute('aria-checked') === 'true';
      hapticSelect();
      await runAction('autorenew', { enabled: !current }, { progress: !current ? 'Включаем автопродление…' : 'Выключаем автопродление…' });
    };
  }
  if ($('unbind-method-btn')) $('unbind-method-btn').onclick = confirmUnbindPaymentMethod;
  document.querySelectorAll('#theme-pills [data-theme-pref]').forEach((btn) => {
    btn.onclick = () => {
      hapticSelect();
      applyTheme(btn.dataset.themePref, true);
    };
  });

  if ($('metric-freeze-btn')) $('metric-freeze-btn').onclick = openFreezeInfoSheet;
  if ($('metric-referral-btn')) $('metric-referral-btn').onclick = openReferralSheet;
  if ($('profile-referral-btn')) $('profile-referral-btn').onclick = openReferralSheet;
  if ($('metric-family-btn')) {
    $('metric-family-btn').onclick = () => {
      if (state?.access_mode === 'family_member') openFreezeInfoSheet();
      else go('devices');
    };
  }

  if ($('locked-retry')) $('locked-retry').onclick = () => { $('locked').hidden = true; $('loading').hidden = false; load(); };
  if ($('locked-support')) $('locked-support').onclick = () => { if (tg?.close) tg.close(); else openTgUrl('https://t.me/nexus_rayt_bot'); };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('sheet')?.classList.contains('open')) {
      e.preventDefault();
      closeSheet();
    }
  });

  initSheetDrag();
  initVisualViewport();
  const scheduleChartRender = () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => { if (state) renderTrafficChart(); }, 90);
  };
  window.addEventListener('resize', scheduleChartRender);
  tg?.onEvent?.('viewportChanged', scheduleChartRender);

  $('refresh').onclick = () => { haptic('light'); load(); };
  $('sheet-close').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;
  $('support-link').onclick = openSupport;

  const OFFER_URL = 'https://telegra.ph/Publichnaya-oferta-Polzovatelskoe-soglashenie-02-22';
  $('offer-link').onclick = () => openExternal(OFFER_URL);
  if ($('inline-offer-link')) {
    $('inline-offer-link').onclick = (e) => { e.preventDefault(); openExternal(OFFER_URL); };
  }
  if ($('open-payment')) {
    $('open-payment').onclick = () => { if (pendingPayment?.confirmation_url) openExternal(pendingPayment.confirmation_url); };
  }
  $('check-payment').onclick = () => verifyPendingPayment(false);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingPayment && !busy) verifyPendingPayment(true);
  });

  if (!initData) {
    setTimeout(() => showLockedScreen('auth'), 400);
  } else {
    load();
  }
})();
