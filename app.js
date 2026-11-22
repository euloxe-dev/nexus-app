(() => {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  let state = null;
  let selectedDevices = 0;
  let pendingPayment = null;
  let busy = false;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#cbb8a4');
    tg.setBackgroundColor?.('#cbb8a4');
    if (tg.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes?.();
  }

  const haptic = (kind='light') => tg?.HapticFeedback?.impactOccurred?.(kind);
  const hapticSelect = () => tg?.HapticFeedback?.selectionChanged?.();
  const notify = (message) => {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.classList.remove('show'), 2600);
  };
  const fmtDate = (seconds) => seconds ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(seconds*1000)).replace(/\s*г\.?$/i,'') : '—';
  const statusText = {active:'Активна',frozen:'Заморожена',expired:'Истекла',inactive:'Отключена',none:'Нет подписки'};
  const paymentText = {pending:'Ожидает оплаты',confirmed:'Подтверждён',processing:'Выдаём доступ',applied:'Оплачен',canceled:'Отменён',failed:'Нужна проверка',manual_review:'Ручная проверка'};
  const monthWord = (n) => n===1?'1 месяц':n<5?`${n} месяца`:`${n} месяцев`;
  const daysRemainingLabel = (n) => {
    const abs = Math.abs(Number(n) || 0), m100 = abs % 100, m10 = abs % 10;
    if (m100 >= 11 && m100 <= 14) return 'дней осталось';
    if (m10 === 1) return 'день остался';
    if (m10 >= 2 && m10 <= 4) return 'дня осталось';
    return 'дней осталось';
  };
  const nbsp = (s) => String(s ?? '').replace(/(^|[\s«(])([вкосуиаВКОСУИА])\s+/g, '$1$2\u00A0');
  const operationId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    'Порой вам проще сделать всё самому, чем объяснять другим, но сегодня делегирование одной мелочи освободит вечер для отдыха.',
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
    if (code.startsWith('s6') || code.startsWith('s4')) return 'Main · Бельгия 🇧🇪';
    if (code.startsWith('s3')) return 'Main · Вена 🇦🇹';
    if (code.startsWith('s5') || code.startsWith('s2')) return 'Reserve · Испания 🇪🇸';
    if (code.startsWith('s1')) return 'Reserve · Нидерланды 🇳🇱';
    if (code.startsWith('d1')) return 'Edge · Цюрих 🇨🇭';
    if (code.startsWith('d2')) return 'Edge · Швеция 🇸🇪';
    if (code) return code.toUpperCase();
    return inactive ? 'Ожидает' : '—';
  };

  const API_BASES = window.location.hostname.endsWith('github.io')
    ? ['https://nexusray.cc/nexus/api/']
    : ['/nexus/api/'];

  async function api(path, options={}) {
    const headers = {'X-Telegram-Init-Data':initData, ...(options.body?{'Content-Type':'application/json'}:{}), ...(options.headers||{})};
    let lastError = null;
    for (const base of API_BASES) {
      try {
        const response = await fetch(`${base}${path}`, {...options, headers});
        let data={}; try { data=await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(data.message || data.error || 'Сервис временно недоступен');
        return data;
      } catch (err) {
        lastError = err;
        if (err instanceof TypeError && API_BASES.length > 1) continue;
        throw err;
      }
    }
    throw lastError || new Error('Сервис временно недоступен');
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
      focusTarget.focus({ preventScroll: true });
      if (typeof focusTarget.select === 'function') focusTarget.select();
    } else {
      sheet?.focus?.({ preventScroll: true });
    }
  }

  function openSheet(title, text, actions, field=false, initialValue='') {
    resetSheetTransform();
    $('sheet-content').innerHTML = `<h2 id="sheet-title">${esc(title)}</h2><p>${esc(nbsp(text))}</p>${field?'<label class="field"><span>Название устройства</span><input id="sheet-input" maxlength="30" autocomplete="off" autocorrect="off" enterkeyhint="done" placeholder="Мой iPhone"></label>':''}<div class="sheet-actions">${actions.map((a)=>`<button type="button" class="${a.class||''}" data-sheet-action="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div>`;
    actions.forEach((action) => {
      const btn = $('sheet-content').querySelector(`[data-sheet-action="${action.id}"]`);
      if (btn) btn.onclick = () => action.run(field ? $('sheet-input').value : '');
    });
    const input = field ? $('sheet-input') : null;
    if (input) {
      input.value = initialValue || '';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const primaryBtn = $('sheet-content').querySelector('.sheet-actions button.primary');
          primaryBtn?.click();
        }
      });
    }
    showSheetModal(input || $('sheet-close'));
  }

  function closeSheet() {
    resetSheetTransform();
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

  function initSheetDrag() {
    const zone = $('sheet-drag-zone');
    const sheet = $('sheet');
    const backdrop = $('backdrop');
    if (!zone || !sheet) return;
    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let instantVy = 0;
    let currentDy = 0;
    let dragging = false;

    const onStart = (clientY) => {
      if (!sheet.classList.contains('open')) return;
      startY = clientY;
      lastY = clientY;
      lastTime = performance.now();
      instantVy = 0;
      currentDy = 0;
      dragging = true;
      sheet.classList.add('is-dragging');
    };
    const onMove = (clientY) => {
      if (!dragging) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      instantVy = (clientY - lastY) / dt;
      lastY = clientY;
      lastTime = now;
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

    zone.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientY);
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
      if (dragging && e.touches.length === 1) onMove(e.touches[0].clientY);
    }, { passive: true });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  }

  async function runAction(path, body, options={}) {
    const {refresh=true, progress='Выполняем…', notifySuccess=true}=options;
    if (busy) return null;
    busy = true;
    closeSheet();
    $('activity-text').textContent = progress;
    $('activity').hidden = false;
    tg?.MainButton?.showProgress?.();
    try {
      const result = await api(path, {method:'POST', body:JSON.stringify(body||{})});
      if (notifySuccess) notify(result.message || 'Готово');
      tg?.HapticFeedback?.notificationOccurred?.('success');
      if (refresh) await load();
      return result;
    } catch (error) {
      notify(error.message);
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
      {id:'stay', label:'Остаться', run:closeSheet},
      {id:'chat', label:'Открыть чат', class:'primary', run:()=>tg?.close?.()},
    ]);
  }

  const fmtDateTime = (seconds) => seconds ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(seconds*1000)) : '';
  const openExternal = (url) => { if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank'); };

  function renderHome() {
    const sub = state.subscription, viewer = state.viewer, familyMember = state.access_mode === 'family_member';
    const inactive = state.cabinet_mode === 'inactive';
    const sale = state.promotions?.global_sale, pers = state.promotions?.personal_discount;
    const hasSale = Boolean(sale?.active && sale.percent > 0);
    const hasPers = Boolean(pers?.active && pers.value > 0);
    document.body.dataset.cabinetMode = state.cabinet_mode || 'inactive';

    const fortune = dailyFortune(viewer);
    $('viewer-name').textContent = fortune.greeting;
    if ($('barnum-text')) $('barnum-text').textContent = fortune.text;
    if ($('barnum-chip-label')) $('barnum-chip-label').textContent = 'Мысль дня';

    const hour = new Date().getHours();
    if ($('greeting')) $('greeting').textContent = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

    const effectiveDays = sub.status === 'frozen'
      ? Math.ceil((sub.frozen_seconds || 0) / 86400)
      : (sub.remaining_days || 0);
    const lowDays = sub.status === 'active' && effectiveDays <= 7;
    const expiringSoon = sub.status === 'active' && effectiveDays <= 5;

    const pill = $('status-pill');
    const statusLabel = expiringSoon ? `Истекает · ${effectiveDays}\u00A0дн.` : (statusText[sub.status] || sub.status);
    if ($('sub-status')) $('sub-status').textContent = statusLabel;
    else if (pill) pill.textContent = statusLabel;
    if (pill) pill.className = `status-pill ${sub.status}${expiringSoon ? ' expiring' : ''}`;

    const daysEl = $('sub-days') || $('days-value');
    if (daysEl) daysEl.textContent = effectiveDays;
    const daysLabelEl = $('sub-days-label') || $('days-label');
    if (daysLabelEl) {
      daysLabelEl.textContent = sub.status === 'frozen'
        ? 'дн. на паузе'
        : sub.status === 'none'
          ? 'нет активного плана'
          : daysRemainingLabel(effectiveDays);
    }
    if ($('subscription-kind')) $('subscription-kind').textContent = familyMember ? 'Семейный доступ' : 'Подписка';
    const untilEl = $('sub-until') || $('expiry-value');
    if (untilEl) {
      untilEl.textContent = sub.status === 'frozen'
        ? 'На паузе'
        : sub.expires_at
          ? `до ${fmtDate(sub.expires_at)}`
          : 'Не оплачена';
    }
    const devEl = $('sub-devices') || $('devices-value');
    if (devEl) devEl.textContent = familyMember ? `${sub.occupied_slots} слот` : `${sub.occupied_slots} / ${sub.device_limit}`;
    const protoText = sub.protocol === 'amneziawg' ? 'AWG' : sub.protocol === 'hysteria' ? 'Hysteria' : '—';
    const protoEl = $('sub-protocol') || $('protocol-value');
    if (protoEl) protoEl.textContent = protoText;
    if ($('bento-protocol-label')) {
      $('bento-protocol-label').textContent = sub.protocol === 'amneziawg' ? '3 контура' : sub.protocol === 'hysteria' ? 'общий ключ' : 'слоты';
    }
    const nodeEl = $('sub-node') || $('card-node-value');
    if (nodeEl) nodeEl.textContent = nodeLabel(sub.server.node, inactive);

    const freeze = $('freeze-action');
    if (freeze) {
      freeze.hidden = familyMember || inactive;
      freeze.dataset.action = sub.status === 'frozen' ? 'unfreeze' : 'freeze';
      const fTitle = $('freeze-title') || freeze.querySelector('b');
      if (fTitle) fTitle.textContent = sub.status === 'frozen' ? 'Разморозка' : 'Заморозка';
      const fSub = $('freeze-sub') || $('freeze-caption');
      if (fSub) fSub.textContent = sub.status === 'frozen' ? 'включить' : `${sub.freeze_bank_days}\u00A0дн.`;
      const fIcon = freeze.querySelector('.mini-wallet-icon, .action-icon');
      if (fIcon) fIcon.innerHTML = icon(sub.status === 'frozen' ? 'refresh' : 'snow');
    }

    const homePromo = $('home-promo');
    if (homePromo) homePromo.hidden = true;

    const purchase = $('purchase-cta');
    const extendBtn = $('card-extend-btn');
    if (extendBtn) extendBtn.hidden = true;
    if (purchase) {
      purchase.hidden = false;
      const persUnit = hasPers ? (pers.type === 'rub' ? '\u00A0₽' : '%') : '';
      const pTitle = $('purchase-cta-title') || purchase.querySelector('b');
      if (pTitle) {
        pTitle.textContent = familyMember
          ? 'Продлить семью'
          : lowDays
            ? 'Продлить сейчас'
            : ['active', 'frozen'].includes(sub.status)
              ? 'Купить время'
              : 'Подключить доступ';
      }
      const pSub = $('purchase-cta-sub') || purchase.querySelector('small');
      if (pSub) {
        pSub.textContent = hasSale
          ? `Акция в тарифах · дни суммируются`
          : hasPers
            ? `Ваша скидка активна · дни суммируются`
            : familyMember
              ? 'Общая подписка · единый баланс'
              : ['active', 'frozen'].includes(sub.status)
                ? 'Продлить доступ · дни суммируются'
                : 'Подключить мгновенно';
      }
      const badge = $('purchase-cta-badge') || $('purchase-badge');
      if (badge) {
        badge.textContent = hasSale
          ? `Акция −${sale.percent}%`
          : hasPers
            ? `−${pers.value}${persUnit}`
            : lowDays
              ? 'Пора продлить'
              : 'До −30%';
      }
    }

    const quickGrid = $('quick-connect-grid');
    const qrBtn = $('quick-qr') || $('qr-action');
    const config = $('quick-config') || $('config-action');
    const multiDevicePlan = (sub.device_limit || 1) > 1 && sub.protocol === 'amneziawg' && !familyMember;
    if (quickGrid) {
      quickGrid.hidden = multiDevicePlan || (inactive && !familyMember);
    }
    if (qrBtn) {
      qrBtn.hidden = multiDevicePlan || (inactive && !familyMember);
      const qTitle = $('quick-qr-title') || qrBtn.querySelector('b');
      const qSub = $('quick-qr-sub') || qrBtn.querySelector('small');
      if (qTitle) qTitle.textContent = 'Большой QR';
      if (qSub) qSub.textContent = sub.protocol === 'amneziawg' ? 'все маршруты' : 'открыть на экране';
    }
    if (config) {
      config.hidden = multiDevicePlan || (inactive && !familyMember);
      const cTitle = $('quick-config-title') || config.querySelector('b');
      const cSub = $('quick-config-sub') || config.querySelector('small');
      if (cTitle) cTitle.textContent = sub.protocol === 'amneziawg' ? 'Файлы в бот' : 'Ссылка в бот';
      if (cSub) cSub.textContent = sub.protocol === 'amneziawg' ? '.conf в чат' : 'ключ в чат';
    }

    renderTrafficChart();
  }

  let focusedSeriesIdx = null;
  let selectedDayIdx = 6;

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
    if (v < 0.0005) return '0\u00A0ГБ';
    if (v < 0.995) {
      const mb = Math.max(1, Math.round(v * 1024));
      return `${mb}\u00A0МБ`;
    }
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

  function renderTrafficChart() {
    const card = $('traffic-card');
    if (!card || !state) return;
    const sub = state.subscription || {};
    const activeDevices = (state.devices || []).filter((d) => d.configured !== false && d.kind !== 'family_pending');
    const seriesList = activeDevices.length
      ? activeDevices.map((d, idx) => ({
          slot: d.slot || idx + 1,
          name: d.member_name || d.name || `Устройство ${d.slot || idx + 1}`,
          rawSeries: Array.isArray(d.traffic_daily_gb) ? d.traffic_daily_gb : null,
        }))
      : [
          {
            slot: 1,
            name: sub.protocol === 'hysteria' ? 'Hysteria · Все устройства' : 'Основное устройство',
            rawSeries: null,
          },
        ];

    const palette = [
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
    const days = Array.from({ length: 7 }, (_, i) => {
      if (i === 6) return 'Сег';
      if (serverDays) {
        const parts = String(serverDays[i] || '').split('-').map(Number);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
          return dayNames[dt.getUTCDay()];
        }
      }
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
      return dayNames[dt.getDay()];
    });

    const inactive = state.cabinet_mode === 'inactive' || sub.status === 'none';
    const series = seriesList.map((item, idx) => {
      const color = palette[idx % palette.length];
      const values = !inactive && item.rawSeries && item.rawSeries.length === 7
        ? item.rawSeries.map((v) => Math.max(0, Number(v) || 0))
        : [0, 0, 0, 0, 0, 0, 0];
      const total = values.reduce((acc, v) => acc + v, 0);
      return { ...item, color, values, total };
    });

    if (focusedSeriesIdx !== null && focusedSeriesIdx >= series.length) {
      focusedSeriesIdx = null;
    }

    const titleEl = $('traffic-title');
    if (titleEl) {
      titleEl.textContent = series.length > 1 ? 'Трафик по устройствам' : 'Трафик устройства';
    }

    const maxVal = Math.max(0, ...series.flatMap((s) => s.values));
    const niceMax = pickNiceTrafficMax(maxVal);

    const box = $('traffic-chart-box');
    const rect = box?.getBoundingClientRect();
    const measuredW = rect?.width || box?.clientWidth || 344;
    const measuredH = rect?.height || box?.clientHeight || 136;
    const W = Math.max(280, Math.round(measuredW));
    const H = Math.max(88, Math.round(measuredH));
    const padL = 10;
    const padR = 10;
    const padT = 10;
    const padB = 16;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const baselineY = padT + plotH;

    const xAt = (i) => padL + (plotW * i) / 6;
    const yAt = (v) => padT + plotH - (Math.min(niceMax, Math.max(0, v)) / niceMax) * plotH;

    const updateHeaderAndLegend = () => {
      const subEl = $('traffic-sub');
      const totalPill = $('traffic-total-pill');
      const activeDayLabel = selectedDayIdx === 6 ? 'Сегодня' : selectedDayIdx === 5 ? 'Вчера' : days[selectedDayIdx];
      const totalWeekAll = series.reduce((acc, s) => acc + s.total, 0);
      if (focusedSeriesIdx !== null && series[focusedSeriesIdx]) {
        const s = series[focusedSeriesIdx];
        const dayVal = fmtTraffic(s.values[selectedDayIdx]);
        const weekVal = fmtTraffic(s.total);
        if (subEl) subEl.textContent = `${s.name} · ${activeDayLabel}: ${dayVal} (за 7\u00A0дн. — ${weekVal})`;
        if (totalPill) totalPill.textContent = weekVal;
      } else {
        const daySum = series.reduce((acc, s) => acc + s.values[selectedDayIdx], 0);
        if (subEl) {
          if (inactive) subEl.textContent = 'Подписка неактивна · трафик не расходуется';
          else if (totalWeekAll < 0.0005) subEl.textContent = 'Учёт трафика активен · обновление каждые 5\u00A0мин';
          else subEl.textContent = `За 7 дней · ${activeDayLabel}: ${fmtTraffic(daySum)} на ${series.length}\u00A0устр.`;
        }
        if (totalPill) totalPill.textContent = fmtTraffic(totalWeekAll);
      }

      const legendEl = $('traffic-legend');
      if (legendEl) {
        legendEl.innerHTML = series.map((s, idx) => {
          const isFocused = focusedSeriesIdx === idx;
          const isDimmed = focusedSeriesIdx !== null && focusedSeriesIdx !== idx;
          const shownVal = fmtTraffic(selectedDayIdx !== null ? s.values[selectedDayIdx] : s.total);
          const shortName = s.name.replace(/^Dan\s+/i, '');
          return `<button type="button" class="legend-chip${isFocused ? ' focused' : ''}${isDimmed ? ' dimmed' : ''}" data-series-idx="${idx}" aria-pressed="${isFocused}">
            <i class="legend-dot" style="background:${s.color.stroke}"></i>
            <span class="legend-name">${esc(shortName)}</span>
            <b class="legend-val">${shownVal}</b>
          </button>`;
        }).join('');

        legendEl.querySelectorAll('[data-series-idx]').forEach((btn) => {
          btn.onclick = () => {
            const idx = Number(btn.dataset.seriesIdx);
            focusedSeriesIdx = focusedSeriesIdx === idx ? null : idx;
            hapticSelect();
            renderTrafficChart();
          };
        });
      }
    };

    updateHeaderAndLegend();

    const defs = series.map((s, idx) => `
      <linearGradient id="tgrad-${idx}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.color.fillTop}"/>
        <stop offset="100%" stop-color="${s.color.fillBottom}"/>
      </linearGradient>
    `).join('');

    const gridValues = [0, niceMax / 2, niceMax];
    const gridLines = gridValues.map((gv) => {
      const y = yAt(gv).toFixed(1);
      const labelY = gv === 0 ? (Number(y) - 3).toFixed(1) : (Number(y) + 8).toFixed(1);
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
          <circle cx="${activePt.x.toFixed(1)}" cy="${activePt.y.toFixed(1)}" r="3.4" fill="${s.color.stroke}" stroke="#ffffff" stroke-width="1.6"/>
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
      const x = Math.max(padL, xAt(i) - step / 2);
      const w = i === 0 || i === 6 ? step / 2 + 6 : step;
      return `<rect x="${x.toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${plotH + padB}" fill="transparent" stroke="none" style="cursor:pointer" data-day-hit="${i}"/>`;
    }).join('');

    if (box) {
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

      const selectDay = (idx) => {
        const clamped = Math.max(0, Math.min(6, idx));
        if (clamped === selectedDayIdx) return;
        selectedDayIdx = clamped;
        hapticSelect();
        renderTrafficChart();
      };

      box.querySelectorAll('[data-day-hit], [data-day-idx]').forEach((el) => {
        el.onclick = () => selectDay(Number(el.dataset.dayHit ?? el.dataset.dayIdx));
      });

      const svgEl = box.querySelector('svg');
      if (svgEl) {
        const onPointerMove = (clientX) => {
          const rect = svgEl.getBoundingClientRect();
          if (!rect.width) return;
          const relX = ((clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((relX - padL) / plotW) * 6);
          selectDay(idx);
        };
        svgEl.addEventListener('touchmove', (e) => {
          if (e.touches.length === 1) onPointerMove(e.touches[0].clientX);
        }, { passive: true });
      }
    }
  }

  function deviceCard(slot, device) {
    if (!device) return `<article class="device-card empty"><div class="device-top"><div class="device-icon" aria-hidden="true">${icon('plus')}</div><div class="device-copy"><small>Слот ${slot}</small><strong>Свободное место</strong><span>Создайте отдельный ключ</span></div></div><button type="button" class="add-device" data-device="add" data-slot="${slot}">+ Добавить устройство</button></article>`;
    if (device.kind === 'family_member') {
      const active = state.subscription.status === 'active' && device.configured;
      const unavailable = active ? '' : ' disabled';
      const note = active ? 'Это только ваш ключ. Владелец семьи не может его скачать или перевыпустить.' : state.subscription.status === 'frozen' ? 'Владелец временно заморозил семейную подписку. Ваше место сохранено.' : state.subscription.status === 'active' ? 'Ключ временно восстанавливается. Попробуйте немного позже.' : 'Подписка владельца сейчас неактивна. Ваше место пока сохранено.';
      return `<article class="device-card family member"><div class="device-top"><div class="device-icon" aria-hidden="true">${icon('family')}</div><div class="device-copy"><small>Ваш семейный слот ${device.slot}</small><strong>${esc(device.name)}</strong><span>Владелец: ${esc(device.owner_name)}</span></div><i class="device-state${active?'':' waiting'}" role="img" aria-label="${active?'Активен':'Ожидает'}"></i></div><div class="device-note">${note}</div><div class="device-buttons"><button type="button" class="accent" data-device="family-qr" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('qr')} Большой QR</button><button type="button" class="accent" data-device="family-get" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('download')} Файлы в бот</button><button type="button" data-device="family-rename" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('edit')} Имя</button><button type="button" data-device="family-regenerate" data-slot="${device.slot}" data-owner="${device.owner_id}"${unavailable}>${icon('refresh')} Сброс</button><button type="button" class="danger" data-device="family-leave" data-slot="${device.slot}" data-owner="${device.owner_id}">Выйти</button></div></article>`;
    }
    if (device.kind === 'family') return `<article class="device-card family"><div class="device-top"><div class="device-icon" aria-hidden="true">${icon('family')}</div><div class="device-copy"><small>Слот ${device.slot} · Семья</small><strong>${esc(device.member_name||device.name)}</strong><span>Отдельный ключ участника</span></div><i class="device-state" role="img" aria-label="Активен"></i></div><div class="device-note">Файл и перевыпуск доступны только самому участнику.</div><button type="button" class="family-danger" data-device="revoke-family" data-slot="${device.slot}">Отозвать доступ</button></article>`;
    if (device.kind === 'family_pending') return `<article class="device-card family pending"><div class="device-top"><div class="device-icon" aria-hidden="true">${icon('shield')}</div><div class="device-copy"><small>Слот ${device.slot} · Семья</small><strong>Приглашение отправлено</strong><span>Ожидает принятия участником</span></div><i class="device-state waiting" role="img" aria-label="Ожидает"></i></div><button type="button" class="family-danger" data-device="cancel-invite" data-slot="${device.slot}">Отменить приглашение</button></article>`;
    return `<article class="device-card"><div class="device-top"><div class="device-icon" aria-hidden="true">${icon('phone')}</div><div class="device-copy"><small>Слот ${device.slot}</small><strong>${esc(device.name)}</strong><span>3 контура · основной, резерв и Edge</span></div><i class="device-state" role="img" aria-label="Активен"></i></div><div class="device-buttons"><button type="button" class="accent" data-device="qr" data-slot="${device.slot}">${icon('qr')} Большой QR</button><button type="button" class="accent" data-device="get" data-slot="${device.slot}">${icon('download')} Файлы в бот</button><button type="button" data-device="rename" data-slot="${device.slot}">${icon('edit')} Имя</button><button type="button" data-device="regenerate" data-slot="${device.slot}">${icon('refresh')} Сброс</button><button type="button" class="danger" data-device="delete" data-slot="${device.slot}" ${device.slot===1?'disabled':''}>${icon('trash')} Удалить</button></div></article>`;
  }

  function renderDevices() {
    const sub = state.subscription;
    const list = $('devices-list') || $('device-list');
    const summary = $('devices-summary') || $('device-summary');
    const slotPill = $('devices-pill') || $('device-slot-pill');
    const slotBar = $('devices-progress') || $('device-slot-bar');
    if (state.access_mode === 'family_member') {
      if (summary) summary.textContent = `Семейный доступ · ${state.family_access.owner_name}`;
      if (slotPill) slotPill.textContent = '1 / 1 слот';
      if (slotBar) slotBar.style.width = '100%';
      if (list) list.innerHTML = state.devices.map((device) => deviceCard(device.slot, device)).join('');
      return;
    }
    const familyCount = (state.family.members || 0) + (state.family.pending || 0);
    if (summary) summary.textContent = `Занято ${sub.occupied_slots} из ${sub.device_limit}${familyCount ? ` · семейных мест ${familyCount}` : ''}`;
    if (slotPill) slotPill.textContent = `${sub.occupied_slots} / ${sub.device_limit}`;
    if (slotBar) {
      const pct = sub.device_limit > 0 ? Math.min(100, Math.round((sub.occupied_slots / sub.device_limit) * 100)) : 0;
      slotBar.style.width = `${pct}%`;
    }
    if (sub.protocol !== 'amneziawg') {
      if (list) list.innerHTML = `<article class="device-card"><div class="device-top"><div class="device-icon" aria-hidden="true">${icon('server')}</div><div class="device-copy"><small>Единая подписка</small><strong>Hysteria</strong><span>До ${sub.device_limit} устройств</span></div><i class="device-state" role="img" aria-label="Активен"></i></div><div class="device-buttons"><button type="button" class="accent" data-global-qr>${icon('qr')} Большой QR</button><button type="button" class="accent" data-global-config>${icon('download')} Ссылка в бот</button><button type="button" style="grid-column:span 6" data-global-regen>${icon('refresh')} Перевыпустить ключ</button></div></article>`;
      return;
    }
    const map = new Map(state.devices.map((d) => [d.slot, d]));
    if (list) list.innerHTML = Array.from({length: sub.device_limit}, (_, i) => deviceCard(i + 1, map.get(i + 1))).join('');
  }

  function renderPlans() {
    const current = state.subscription.device_limit || 1;
    const familyMember = state.access_mode === 'family_member';
    const familyLimit = state.family_access?.plan_limit || 7;
    if (familyMember) selectedDevices = familyLimit;
    else if (![1, 3, 7].includes(selectedDevices)) selectedDevices = current;

    const sale = state.promotions?.global_sale, pers = state.promotions?.personal_discount;
    const hasSale = Boolean(sale?.active && sale.percent > 0);
    const hasPers = Boolean(pers?.active && pers.value > 0);
    const banner = $('promo-banner');
    if (banner) {
      if (hasSale) {
        const monthsList = (sale.months || []).length === 4 ? 'на все периоды' : `на ${(sale.months || []).join(' / ')} мес.`;
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

    const selector = $('device-limit-selector') || $('device-selector');
    const limits = [1, 3, 7];
    const segIdx = Math.max(0, limits.indexOf(selectedDevices));
    selector.classList.toggle('single', familyMember);
    selector.style.setProperty('--seg-idx', String(segIdx));
    selector.innerHTML = familyMember
      ? `<div class="seg-pill" aria-hidden="true"></div><button type="button" class="active" aria-pressed="true" disabled>${familyLimit} устройств · вся семья</button>`
      : `<div class="seg-pill" aria-hidden="true"></div>` + limits.map((n) => `<button type="button" data-limit="${n}" aria-pressed="${n===selectedDevices}" class="${n===selectedDevices?'active':''}">${n===current?`${n} · сейчас`:`${n} устр.`}</button>`).join('');

    const active = !familyMember && ['active','frozen'].includes(state.subscription.status);
    const changing = active && selectedDevices !== current;
    const context = $('plan-change-box') || $('plan-context');
    const captionEl = $('plans-subtitle') || $('plans-caption');
    const listEl = $('plans-list') || $('plan-list');
    const selectedOption = state.plan_change?.[String(selectedDevices)] || {allowed:true, reason:''};
    if (changing) {
      const option = selectedOption;
      const frozen = state.subscription.status === 'frozen';
      const oldItem = state.plans.find((p)=>p.months===1).prices.find((p)=>p.devices===current);
      const newItem = state.plans.find((p)=>p.months===1).prices.find((p)=>p.devices===selectedDevices);
      const oldPrice = oldItem.base_amount || oldItem.amount;
      const newPrice = newItem.base_amount || newItem.amount;
      const seconds = frozen ? state.subscription.frozen_seconds : Math.max(0, state.subscription.expires_at - Date.now()/1000);
      const newDays = Math.max(1, Math.ceil(seconds * oldPrice / newPrice / 86400));
      const blocked = frozen ? 'Сначала разморозьте подписку.' : option.reason;
      context.hidden = false;
      context.className = `plan-context${blocked?' blocked':''}`;
      context.innerHTML = `<small>Изменение текущего тарифа</small><h2>${current} → ${selectedDevices} устройств</h2><p>Это не покупка: деньги не списываются. Остаток времени будет пересчитан по стоимости тарифа — примерно <b>${newDays}\u00A0дн.</b></p>${blocked?`<div class="plan-warning">${esc(blocked)}</div>`:'<div class="plan-safe">Ни один ключ не будет удалён автоматически.</div>'}<button type="button" data-change-plan ${blocked?'disabled':''}>Изменить лимит</button>`;
      if (captionEl) captionEl.textContent = 'Смена лимита отделена от покупки времени.';
      if (listEl) listEl.innerHTML = '';
      return;
    }
    if (!selectedOption.allowed && !changing) {
      context.hidden = false;
      context.className = 'plan-context blocked';
      context.innerHTML = `<small>Тариф недоступен</small><h2>${selectedDevices} устройств</h2><p>Семейные места принадлежат другим пользователям и не могут исчезнуть при покупке.</p><div class="plan-warning">${esc(selectedOption.reason)}</div>`;
      if (captionEl) captionEl.textContent = 'Сначала освободите семейные места.';
      if (listEl) listEl.innerHTML = '';
      return;
    }
    if (familyMember) {
      context.hidden = false;
      context.className = 'plan-context family-switch';
      context.innerHTML = `<small>Общая семейная подписка</small><h2>Оплата для всей семьи</h2><p>Дни будут начислены подписке владельца <b>${esc(state.family_access.owner_name)}</b> и автоматически продлят доступ всех участников.</p><div class="plan-safe">Если позже выйти из семьи, уже оплаченные дни останутся у семейной подписки. Личный тариф покупается только после выхода.</div>`;
      if (captionEl) captionEl.textContent = 'Выберите срок продления общей подписки.';
    } else {
      context.hidden = true;
      if (captionEl) captionEl.textContent = active ? 'Дни суммируются с текущим остатком.' : 'Выберите количество устройств и период.';
    }
    const defaultPct = { 1: 0, 3: 8, 6: 17, 12: 30 };
    if (listEl) listEl.innerHTML = state.plans.map((plan) => {
      const item = plan.prices.find((p) => p.devices === selectedDevices);
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
      return `<article class="plan-card ${featured?'featured':popular?'popular':''} ${hasDiscount?'sale-active':''}"><div><div class="plan-badges">${badges.join('')}</div><strong>${monthWord(plan.months)}</strong><div class="price-row"><strong>${item.amount}\u00A0₽</strong>${hasDiscount?`<s>${baseAmount}\u00A0₽</s>`:''}</div><div class="plan-meta">${selectedDevices}\u00A0устр. · ≈${perMonth}\u00A0₽/мес.</div></div><button type="button" data-buy="${plan.months}" ${!state.payments_enabled?'disabled':''}>${hasDiscount?'Забрать':'Выбрать'}</button></article>`;
    }).join('');
  }

  function renderMore() {
    const familyMember = state.access_mode === 'family_member';
    $('profile-id').textContent = `Telegram ID ${state.viewer.id}`;
    $('metric-one-label').textContent = familyMember ? 'Тип доступа' : 'Заморозка';
    $('metric-one-icon').innerHTML = icon(familyMember ? 'family' : 'snow');
    $('freeze-bank').textContent = familyMember ? 'Семья' : `${state.subscription.freeze_bank_days}\u00A0дн.`;
    $('referral-count').textContent = state.referral?.invited ?? 0;
    $('family-count').textContent = familyMember ? state.family_access.owner_name : state.family.members ? `${state.family.members}\u00A0чел.` : 'Нет';
    const rows = state.payment_history || [];
    $('payment-history').innerHTML = rows.length
      ? rows.map((p) => {
          const family = p.purpose === 'family_topup';
          const source = family && p.payer_id !== state.viewer.id ? ' · оплатил участник' : '';
          return `<article class="history-row"><span class="history-icon" aria-hidden="true">₽</span><div><b>${family?'Вся семья':monthWord(p.months)} · ${p.devices}\u00A0устр.</b><small>${fmtDate(p.applied_at||p.created_at)} · ${esc(paymentText[p.status]||p.status)}${source}</small></div><strong>${p.amount}\u00A0₽</strong></article>`;
        }).join('')
      : '<div class="empty-history">Платежей пока нет</div>';
  }

  function render() {
    renderHome();
    renderDevices();
    renderPlans();
    renderMore();
    bindDynamic();
  }

  function bindDynamic() {
    document.querySelectorAll('[data-limit]').forEach((b) => b.onclick = () => {
      const nextLimit = Number(b.dataset.limit);
      if (nextLimit === selectedDevices) return;
      selectedDevices = nextLimit;
      hapticSelect();
      renderPlans();
      bindDynamic();
    });
    document.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => startPurchase(Number(b.dataset.buy)));
    const changePlan = document.querySelector('[data-change-plan]');
    if (changePlan) changePlan.onclick = confirmPlanChange;
    document.querySelectorAll('[data-device]').forEach((b) => b.onclick = () => devicePrompt(b.dataset.device, Number(b.dataset.slot), Number(b.dataset.owner || 0)));
    const globalConfig = document.querySelector('[data-global-config]');
    if (globalConfig) globalConfig.onclick = sendGlobalConfig;
    const globalQr = document.querySelector('[data-global-qr]');
    if (globalQr) globalQr.onclick = () => openQrModal(1, 0);
    const globalRegen = document.querySelector('[data-global-regen]');
    if (globalRegen) globalRegen.onclick = confirmRegenerate;
  }

  async function openQrModal(slot=1, ownerId=0, freshNotice='') {
    const data = await runAction('qr', {slot, owner_id:ownerId||undefined}, {refresh:false, progress:'Готовим большой QR-код…', notifySuccess:false});
    if (!data || !data.items?.length) return;
    let idx = 0;
    const items = data.items;
    const multi = items.length > 1;

    const qrTabLabel = (it, i) => {
      if (it.role === 'primary') return 'Основной';
      if (it.role === 'reserve') return 'Резерв';
      if (it.role === 'edge') return 'Edge';
      return it.title || `Маршрут ${i + 1}`;
    };

    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">${esc(data.device_name || `Слот ${slot}`)}</h2>
      ${freshNotice
        ? `<div class="qr-fresh-banner">✓ ${esc(freshNotice)}</div>`
        : `<p>${multi ? 'Переключайте маршруты свайпом или вкладками.' : 'Отсканируйте QR-код с другого устройства или отправьте файлы в бот.'}</p>`}
      <div class="qr-viewer" id="qr-swipe-area">
        <div class="qr-tabs ${multi?'':'single'}" id="qr-tabs" role="tablist" aria-label="Маршрут" style="--qr-idx:0;--qr-count:${items.length}">
          <div class="qr-tab-pill" aria-hidden="true"></div>
          ${items.map((it, i) => `<button type="button" role="tab" aria-selected="${i===0}" data-qr-tab="${i}" class="${i===0?'active':''}">${esc(qrTabLabel(it, i))}</button>`).join('')}
        </div>
        <div class="qr-carousel-viewport" id="qr-viewport">
          <div class="qr-carousel-track" id="qr-track">
            ${items.map((cur, i) => `
              <div class="qr-slide" ${i===0?'':'inert aria-hidden="true"'}>
                <div class="qr-box">
                  <img src="${cur.qr_data_url}" alt="QR-код ${esc(cur.title)}: ${esc(cur.subtitle)}">
                  <div class="qr-route-bar">
                    ${multi ? `<button type="button" class="qr-arrow" data-qr-dir="-1" aria-label="Предыдущий маршрут" ${i===0?'disabled':''}>‹</button>` : '<span></span>'}
                    <div class="qr-route-copy">
                      <div class="qr-route-label">${esc(cur.title)}</div>
                      <div class="qr-route-sub">${esc(cur.subtitle)}</div>
                    </div>
                    ${multi ? `<button type="button" class="qr-arrow" data-qr-dir="1" aria-label="Следующий маршрут" ${i===items.length-1?'disabled':''}>›</button>` : '<span></span>'}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ${multi ? `<div class="qr-dots" id="qr-dots" aria-hidden="true">${items.map((_, i) => `<i class="${i===0?'active':''}"></i>`).join('')}</div>` : ''}
        <div class="qr-hint">Приложение <b>EX WG</b> или <b>AmneziaWG</b> → <b>«+»</b> → <b>Сканировать QR-код</b></div>
      </div>
      <div class="sheet-actions">
        <button type="button" id="qr-send-files">Файлы .conf в бот</button>
        <button type="button" class="primary" id="qr-done">Готово</button>
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
      if (dotsEl) {
        dotsEl.querySelectorAll('i').forEach((d, i) => d.classList.toggle('active', i === idx));
      }
    };

    $('sheet-content').querySelectorAll('[data-qr-tab]').forEach((b) => {
      b.onclick = () => syncActiveSlide(Number(b.dataset.qrTab), true);
    });
    $('sheet-content').querySelectorAll('[data-qr-dir]').forEach((b) => {
      b.onclick = () => {
        const dir = Number(b.dataset.qrDir);
        syncActiveSlide(idx + dir, true);
      };
    });

    if (viewportEl && trackEl && multi) {
      let startX = 0;
      let startY = 0;
      let lastX = 0;
      let lastTime = 0;
      let instantVx = 0;
      let currentDx = 0;
      let swiping = false;
      let lockedAxis = '';

      viewportEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastX = startX;
        lastTime = performance.now();
        instantVx = 0;
        currentDx = 0;
        swiping = true;
        lockedAxis = '';
      }, { passive: true });

      viewportEl.addEventListener('touchmove', (e) => {
        if (!swiping || e.touches.length !== 1) return;
        const now = performance.now();
        const dt = Math.max(1, now - lastTime);
        const clientX = e.touches[0].clientX;
        instantVx = (clientX - lastX) / dt;
        lastX = clientX;
        lastTime = now;
        const dx = clientX - startX;
        const dy = e.touches[0].clientY - startY;
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

    $('qr-done').onclick = closeSheet;
    $('qr-send-files').onclick = async () => {
      if (data.protocol === 'hysteria') {
        sendGlobalConfig();
        return;
      }
      const act = ownerId ? 'family-get' : 'get';
      const r = await runAction('devices', {action:act, slot, owner_id:ownerId||undefined}, {progress:'Отправляем .conf файлы в чат…', notifySuccess:false});
      if (r) showDeliveryResult(r.message);
    };

    showSheetModal($('qr-done'));
  }

  function openQuickQr() {
    if (state.access_mode === 'family_member') {
      const first = state.devices?.[0];
      if (first && state.devices.length === 1) {
        openQrModal(first.slot, first.owner_id);
        return;
      }
      go('devices');
      notify('Выберите свой семейный слот для показа QR.');
      return;
    }
    if (state.subscription.protocol === 'amneziawg') {
      const own = (state.devices || []).filter((d) => !d.kind || d.kind === 'personal');
      if (own.length === 1) {
        openQrModal(own[0].slot, 0);
        return;
      }
      go('devices');
      notify('Выберите устройство для показа большого QR.');
      return;
    }
    openQrModal(1, 0);
  }

  function openGuideSheet() {
    resetSheetTransform();
    $('sheet-content').innerHTML = `
      <h2 id="sheet-title">Инструкция подключения</h2>
      <p>Установите приложение <b>EX WG</b> (установщик доступен в боте для Android и Windows) или официальный <b>AmneziaWG</b>:</p>
      <div class="guide-steps">
        <div class="guide-step"><b>1</b><div>Скачайте приложение <b>AmneziaWG</b> по кнопкам ниже или получите <b>EX WG 1.0</b> в разделе инструкций бота.</div></div>
        <div class="guide-step"><b>2</b><div>Нажмите <b>«Большой QR»</b> (для сканирования с другого экрана) или <b>«Файлы в бот»</b> (придёт архив <code>neXusRay.zip</code> и отдельные <code>.conf</code>).</div></div>
        <div class="guide-step"><b>3</b><div>Добавьте все 3 маршрута (основной, резерв и Edge) — включайте по одному тумблеру, а при просадке сети просто переключите страну.</div></div>
      </div>
      <div class="app-links">
        <button type="button" data-app-url="https://apps.apple.com/app/amneziawg/id6478942365">iPhone / iPad</button>
        <button type="button" data-app-url="https://play.google.com/store/apps/details?id=org.amnezia.awg">Android</button>
        <button type="button" data-app-url="https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest">Windows</button>
        <button type="button" data-app-url="https://apps.apple.com/app/amneziawg/id6478942365">macOS</button>
      </div>
      <div class="sheet-actions" style="grid-template-columns:1fr">
        <button type="button" class="primary" id="guide-close">Понятно</button>
      </div>`;
    $('sheet-content').querySelectorAll('[data-app-url]').forEach((b) => b.onclick = () => openExternal(b.dataset.appUrl));
    $('guide-close').onclick = closeSheet;
    showSheetModal($('guide-close'));
  }

  async function startPurchase(months) {
    const current = state.subscription.device_limit, familyMember = state.access_mode === 'family_member', active = !familyMember && ['active','frozen'].includes(state.subscription.status);
    if (active && selectedDevices !== current) {
      notify('Сначала примените изменение лимита.');
      return;
    }
    const item = state.plans.find((p)=>p.months===months).prices.find((p)=>p.devices===selectedDevices);
    const price = item.amount, basePrice = item.base_amount || item.amount;
    const priceLine = price < basePrice ? `Стоимость со скидкой (${item.discount_label||'акция'}): ${price} ₽ вместо ${basePrice} ₽.` : `К оплате: ${price} ₽.`;
    const familyWarning = familyMember ? ` Платёж продлит общую подписку владельца ${state.family_access.owner_name}; дни получат все участники и останутся у семьи даже после вашего выхода.` : '';
    openSheet(
      familyMember ? 'Продлить всю семью' : 'Купить подписку',
      `${monthWord(months)}, до ${selectedDevices} устройств. ${priceLine}${familyWarning}`,
      [
        {id:'cancel', label:'Отмена', run:closeSheet},
        {id:'pay', label:`Оплатить ${price} ₽`, class:'primary', run:async()=>{
          const r = await runAction('payments', {months, devices:selectedDevices}, {refresh:false, progress:'Создаём безопасный счёт…'});
          if (r) {
            pendingPayment = r;
            $('pending-payment').hidden = false;
            $('pending-amount').textContent = `${r.amount}\u00A0₽`;
            openExternal(r.confirmation_url);
          }
        }},
      ]
    );
  }

  function confirmPlanChange() {
    const current = state.subscription.device_limit;
    openSheet(
      'Изменить лимит?',
      `Текущий тариф: ${current} устройств. Новый тариф: ${selectedDevices}. Это не покупка — деньги не списываются, изменится остаток дней.`,
      [
        {id:'cancel', label:'Отмена', run:closeSheet},
        {id:'go', label:'Изменить лимит', class:'primary', run:()=>runAction('plan', {devices:selectedDevices, operation_id:operationId(), state_version:state.state_version}, {progress:'Меняем лимит…'})},
      ]
    );
  }

  function confirmRegenerate() {
    if (state.access_mode === 'family_member') {
      const first = state.devices?.[0];
      if (first && state.devices.length === 1) {
        devicePrompt('family-regenerate', first.slot, first.owner_id);
        return;
      }
      go('devices');
      notify('Выберите свой семейный слот для перевыпуска.');
      return;
    }
    if (state.subscription.protocol === 'amneziawg') {
      const own = (state.devices || []).filter((d) => !d.kind || d.kind === 'personal');
      if (own.length === 1) {
        devicePrompt('regenerate', own[0].slot, 0);
        return;
      }
      go('devices');
      notify('Выберите устройство для перевыпуска.');
      return;
    }
    openSheet(
      'Перевыпустить доступ?',
      'Старая ссылка сразу перестанет работать. Мы сразу покажем новый QR-код и отправим ссылку в бот.',
      [
        {id:'cancel', label:'Отмена', run:closeSheet},
        {id:'go', label:'Перевыпустить', class:'danger', run:async()=>{
          const r = await runAction('regenerate', {operation_id:operationId(), state_version:state.state_version}, {progress:'Безопасно перевыпускаем доступ…', notifySuccess:false});
          if (r) await openQrModal(1, 0, 'Ключ обновлён · новая ссылка также отправлена в бот');
        }},
      ]
    );
  }

  function devicePrompt(action, slot, ownerId=0) {
    if (action === 'qr' || action === 'family-qr') {
      openQrModal(slot, action === 'family-qr' ? ownerId : 0);
      return;
    }
    const device = state.devices.find((item) => item.slot === slot);
    if (['add','rename','family-rename'].includes(action)) {
      openSheet(
        action === 'add' ? 'Новое устройство' : 'Переименовать устройство',
        'Укажите короткое понятное название — например, «iPhone» или «Ноутбук».',
        [
          {id:'cancel', label:'Отмена', run:closeSheet},
          {id:'go', label:action === 'add' ? 'Создать' : 'Сохранить', class:'primary', run:async(name)=>{
            const createsConfig = action === 'add';
            const r = await runAction('devices', {action, slot, name, owner_id:ownerId||undefined}, {progress:createsConfig?'Создаём устройство и готовим QR…':'Сохраняем название…', notifySuccess:!createsConfig});
            if (r && createsConfig) await openQrModal(slot, 0, 'Устройство создано · файлы .conf также отправлены в бот');
          }},
        ],
        true,
        action === 'add' ? '' : (device?.name || '')
      );
      return;
    }
    const labels = {
      get: ['Отправить файлы в бот', `Файлы .conf и QR для «${device?.name||`Слот ${slot}`}» придут в чат с ботом.`, 'Отправить в бот'],
      regenerate: ['Перевыпустить ключ?', `Старый ключ устройства «${device?.name||`Слот ${slot}`}» перестанет работать. Новый QR сразу откроется здесь, а файлы .conf придут в бот.`, 'Перевыпустить'],
      delete: ['Удалить устройство?', `Ключ «${device?.name||`Слот ${slot}`}» перестанет работать на основном и резервном сервере.`, 'Удалить'],
      ['revoke-family']: ['Отозвать семейный доступ?', `Участник «${device?.member_name||device?.name||`Слот ${slot}`}» потеряет доступ на основном и резервном сервере.`, 'Отозвать'],
      ['cancel-invite']: ['Отменить приглашение?', 'Ссылка перестанет действовать, а слот снова станет свободным.', 'Отменить приглашение'],
      ['family-get']: ['Получить семейные настройки', `Файлы .conf и QR для «${device?.name||`Слот ${slot}`}» придут в ваш чат с ботом.`, 'Отправить в бот'],
      ['family-regenerate']: ['Перевыпустить семейный ключ?', `Только ваш ключ «${device?.name||`Слот ${slot}`}» перестанет работать. Новый QR сразу откроется здесь, а файлы придут в бот.`, 'Перевыпустить'],
      ['family-leave']: ['Выйти из семьи?', 'Ваш ключ сразу перестанет работать, а уже оплаченные вами семейные дни останутся у общей подписки. После выхода личный тариф нужно купить отдельно.', 'Выйти из семьи'],
    };
    const [title, text, label] = labels[action];
    openSheet(title, text, [
      {id:'cancel', label:'Отмена', run:closeSheet},
      {id:'go', label, class:['delete','regenerate','revoke-family','cancel-invite','family-regenerate','family-leave'].includes(action)?'danger':'primary', run:async()=>{
        const sendsConfig = ['get','regenerate','family-get','family-regenerate'].includes(action);
        const rotating = ['regenerate','family-regenerate'].includes(action);
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
          if (rotating) await openQrModal(slot, action === 'family-regenerate' ? ownerId : 0, 'Ключ перевыпущен · новые файлы .conf также в чате бота');
          else if (sendsConfig) showDeliveryResult(r.message);
        }
      }},
    ]);
  }

  async function sendGlobalConfig() {
    if (state.access_mode === 'family_member' || state.subscription.protocol === 'amneziawg') {
      const own = (state.devices || []).filter((d) => !d.kind || d.kind === 'personal' || d.kind === 'family_member');
      if (own.length === 1) {
        const d = own[0];
        const act = d.kind === 'family_member' ? 'family-get' : 'get';
        const r = await runAction('devices', {action:act, slot:d.slot, owner_id:d.owner_id||undefined}, {progress:'Отправляем .conf файлы в чат…', notifySuccess:false});
        if (r) showDeliveryResult(r.message);
        return;
      }
      go('devices');
      notify(state.access_mode === 'family_member' ? 'Выберите свой семейный слот.' : 'Выберите нужное устройство.');
      return;
    }
    const r = await runAction('configs', {}, {progress:'Отправляем настройки в Telegram…', notifySuccess:false});
    if (r) showDeliveryResult(r.message);
  }

  async function load() {
    const refreshBtn = $('refresh');
    refreshBtn?.classList.add('is-spinning');
    try {
      state = await api('me');
      selectedDevices = selectedDevices || (state.access_mode === 'family_member' ? (state.family_access?.plan_limit || 7) : state.subscription.device_limit);
      $('loading').hidden = true;
      $('locked').hidden = true;
      $('content').hidden = false;
      $('nav').hidden = false;
      render();
      requestAnimationFrame(() => renderTrafficChart());
    } catch (error) {
      $('loading').hidden = true;
      $('content').hidden = true;
      $('nav').hidden = true;
      $('locked').hidden = false;
    } finally {
      setTimeout(() => refreshBtn?.classList.remove('is-spinning'), 320);
    }
  }

  document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => go(b.dataset.view));
  document.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  document.querySelectorAll('[data-action]').forEach((b) => b.onclick = () => {
    const action = b.dataset.action;
    if (action === 'qr') openQuickQr();
    else if (action === 'guide') openGuideSheet();
    else if (action === 'configs') sendGlobalConfig();
    else if (action === 'regenerate') confirmRegenerate();
    else if (action === 'freeze' || action === 'unfreeze') {
      openSheet(
        action === 'freeze' ? 'Заморозить подписку?' : 'Разморозить подписку?',
        action === 'freeze' ? 'Дни перестанут расходоваться, а доступ временно приостановится.' : 'Доступ снова включится, а сохранённые дни продолжат расходоваться.',
        [
          {id:'cancel', label:'Отмена', run:closeSheet},
          {id:'go', label:action === 'freeze' ? 'Заморозить' : 'Разморозить', class:'primary', run:()=>runAction(action, {}, {progress:action === 'freeze' ? 'Замораживаем подписку…' : 'Размораживаем подписку…'})},
        ]
      );
    }
  });

  if ($('card-node-btn')) {
    $('card-node-btn').onclick = () => {
      if (state?.cabinet_mode !== 'inactive') openQuickQr();
    };
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('sheet')?.classList.contains('open')) {
      e.preventDefault();
      closeSheet();
    }
  });

  initSheetDrag();
  window.addEventListener('resize', () => {
    if (state) renderTrafficChart();
  });
  $('refresh').onclick = () => { haptic('light'); load(); };
  $('sheet-close').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;
  $('support-link').onclick = () => {
    if (tg?.openTelegramLink) tg.openTelegramLink(state.support_url);
    else window.open(state.support_url, '_blank');
  };
  const OFFER_URL = 'https://telegra.ph/Publichnaya-oferta-Polzovatelskoe-soglashenie-02-22';
  $('offer-link').onclick = () => openExternal(OFFER_URL);
  if ($('inline-offer-link')) {
    $('inline-offer-link').onclick = (e) => {
      e.preventDefault();
      openExternal(OFFER_URL);
    };
  }
  if ($('open-payment')) {
    $('open-payment').onclick = () => {
      if (pendingPayment?.confirmation_url) openExternal(pendingPayment.confirmation_url);
    };
  }
  $('check-payment').onclick = async () => {
    if (!pendingPayment) return;
    const r = await runAction('payments/check', {payment_id:pendingPayment.payment_id}, {progress:'Проверяем оплату…'});
    if (['applied','confirmed','manual_review','canceled'].includes(r?.status)) {
      $('pending-payment').hidden = true;
      pendingPayment = null;
    }
  };
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !pendingPayment || busy) return;
    try {
      const r = await api('payments/check', {
        method: 'POST',
        body: JSON.stringify({ payment_id: pendingPayment.payment_id }),
      });
      if (['applied','confirmed','manual_review','canceled'].includes(r?.status)) {
        $('pending-payment').hidden = true;
        pendingPayment = null;
        if (r?.status === 'applied' || r?.status === 'confirmed') {
          notify(r.message || 'Оплата подтверждена!');
          await load();
        }
      }
    } catch (_) {}
  });
  if (!initData) {
    setTimeout(() => {
      $('loading').hidden = true;
      $('locked').hidden = false;
    }, 500);
  } else {
    load();
  }
})();
