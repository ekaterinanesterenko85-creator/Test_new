/**
 * Персональная программа снижения веса.
 * Все данные хранятся только в localStorage и не отправляются на сервер.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "weight-program-v1";
  const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const MEAL_LABELS = { breakfast: "Завтрак", lunch: "Обед", dinner: "Ужин", snack: "Перекус" };

  const HEALTH_QUESTIONS = [
    { id: "meds", label: "Принимаете ли вы лекарства, которые могут влиять на вес или переносимость нагрузки?" },
    { id: "jointBack", label: "Есть ли боли в спине?" },
    { id: "jointKnees", label: "Есть ли боли в коленях?" },
    { id: "jointHips", label: "Есть ли боли в тазобедренных суставах?" },
    { id: "jointOther", label: "Есть ли боли в других суставах?" },
    { id: "bp", label: "Есть ли повышенное артериальное давление?" },
    { id: "bpControlled", label: "Если давление повышено: удаётся ли его контролировать вместе с врачом?", optional: true },
    { id: "diabetes", label: "Есть ли диабет или предиабет?" },
    { id: "cardiovascular", label: "Есть ли сердечно-сосудистые заболевания?" },
    { id: "cvUnstable", label: "Если есть заболевания сердца или сосудов: есть ли нестабильное состояние, боль в груди или одышка в покое?", optional: true },
    { id: "kidneyLiverGi", label: "Есть ли заболевания почек, печени или желудочно-кишечного тракта?" },
    { id: "thyroid", label: "Есть ли заболевания щитовидной железы?" },
    { id: "pregnancy", label: "Есть ли беременность?" },
    { id: "breastfeeding", label: "Идёт ли грудное вскармливание?" },
    { id: "eatingDisorder", label: "Есть ли сейчас или было ранее расстройство пищевого поведения?" },
    { id: "surgeryInjury", label: "Была ли недавно операция или есть острая травма?" },
    { id: "acuteSymptoms", label: "Бывают ли головокружение, обмороки, боль или давление в груди, внезапная слабость или выраженная одышка при нагрузке?" }
  ];

  let state = createEmptyState();
  let quizStep = 1;
  let moreOpen = false;

  /* ---------- хранилище ---------- */

  function createEmptyState() {
    return {
      consent: false,
      isDemo: false,
      createdAt: null,
      profile: null,
      program: null,
      nutrition: null,
      training: null,
      habits: { weekStart: mondayOf(new Date()), checks: {} },
      diary: [],
      lastReviewAt: null,
      pendingAdjustment: null,
      reduceTraining: false,
      theme: "light"
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyState();
      const parsed = JSON.parse(raw);
      return Object.assign(createEmptyState(), parsed);
    } catch (err) {
      console.warn("Не удалось прочитать сохранённые данные", err);
      return createEmptyState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    state = createEmptyState();
    applyTheme();
    quizStep = 1;
    showView("home");
    refreshChrome();
    toast("Все локальные данные удалены.");
  }

  /* ---------- даты ---------- */

  function isoDate(date) {
    const d = new Date(date);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function mondayOf(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return isoDate(d);
  }

  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function formatDateRu(iso) {
    const [y, m, d] = iso.split("-");
    return d + "." + m + "." + y;
  }

  /* ---------- расчёты ---------- */

  function calcBMI(weightKg, heightCm) {
    const meters = heightCm / 100;
    if (!weightKg || !meters) return 0;
    return weightKg / (meters * meters);
  }

  function getBMICategory(bmi) {
    if (bmi < 18.5) return { id: "under", label: "Ниже ориентировочного диапазона ИМТ" };
    if (bmi < 25) return { id: "typical", label: "Ориентировочный диапазон ИМТ" };
    if (bmi < 30) return { id: "elevated", label: "ИМТ выше ориентировочного диапазона" };
    if (bmi < 35) return { id: "high1", label: "ИМТ соответствует I степени ожирения по классификации ВОЗ" };
    if (bmi < 40) return { id: "high2", label: "ИМТ соответствует II степени ожирения по классификации ВОЗ" };
    return { id: "high3", label: "ИМТ соответствует III степени ожирения по классификации ВОЗ" };
  }

  function weightForBMI(heightCm, bmiValue) {
    const meters = heightCm / 100;
    return bmiValue * meters * meters;
  }

  /** Основной обмен по формуле Миффлина — Сан Жеора, ккал/сутки. */
  function calcBMR(weightKg, heightCm, age, sex) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === "male" ? base + 5 : base - 161;
  }

  function getActivityFactor(activityLevel) {
    const map = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };
    return map[activityLevel] || 1.2;
  }

  function calcTDEE(bmr, activityLevel) {
    return bmr * getActivityFactor(activityLevel);
  }

  function calcCalorieRange(tdee, sex, canUseDeficit) {
    const floor = sex === "male" ? 1500 : 1200;
    if (!canUseDeficit) {
      return { blocked: true, min: null, max: null, floor: floor, usedFloor: false };
    }
    const low = tdee * 0.8;
    const high = tdee * 0.9;
    if (high < floor) {
      return { blocked: true, min: null, max: null, floor: floor, usedFloor: true, consult: true };
    }
    return {
      blocked: false,
      min: Math.round(Math.max(low, floor)),
      max: Math.round(Math.max(high, floor)),
      floor: floor,
      usedFloor: low < floor,
      consult: false
    };
  }

  function calcWeightDiff(current, target) {
    return current - target;
  }

  function calcTimeRangeWeeks(diffKg) {
    if (diffKg <= 0) return { min: 0, max: 0 };
    return {
      min: Math.ceil(diffKg / 0.75),
      max: Math.ceil(diffKg / 0.25)
    };
  }

  function calcWeightChangePercent(current, target) {
    if (!current) return 0;
    return ((current - target) / current) * 100;
  }

  function calcWaistToHeight(waistCm, heightCm) {
    if (!waistCm || !heightCm) return null;
    return waistCm / heightCm;
  }

  function calcStepsGoal(currentSteps, safetyLevel) {
    const base = Math.max(Number(currentSteps) || 3000, 1500);
    if (safetyLevel === "red") return Math.round(base);
    const next = Math.round(base * 1.08);
    return Math.min(next, base + 1200);
  }

  function calcIntermediateGoal(currentWeight, targetWeight, heightCm) {
    const minSafe = weightForBMI(heightCm, 18.5);
    const fivePercent = currentWeight * 0.95;
    const threePercent = currentWeight * 0.97;
    let goal = fivePercent;
    if (targetWeight < currentWeight) {
      goal = Math.max(targetWeight, fivePercent);
      if (currentWeight - targetWeight < currentWeight * 0.03) goal = targetWeight;
      else if (currentWeight - targetWeight < currentWeight * 0.05) goal = Math.min(threePercent, currentWeight - 1);
    }
    if (goal < minSafe) goal = Math.max(minSafe, currentWeight * 0.97);
    return Math.round(goal * 10) / 10;
  }

  /* ---------- безопасность ---------- */

  function isYes(value) {
    return value === "yes";
  }

  function assessSafety(profile) {
    const reasons = [];
    const yellow = [];
    let emergency = false;
    let red = false;

    const bmi = calcBMI(profile.weightKg, profile.heightCm);
    const underage = profile.age < 18;

    if (underage) {
      red = true;
      reasons.push("Возраст меньше 18 лет: программа снижения веса для взрослых не составляется.");
    }
    if (bmi > 0 && bmi < 18.5) {
      red = true;
      reasons.push("ИМТ ниже 18.5: дефицит калорий и программа похудения не формируются.");
    }
    if (isYes(profile.pregnancy)) {
      red = true;
      reasons.push("Беременность.");
    }
    if (isYes(profile.breastfeeding)) {
      red = true;
      reasons.push("Грудное вскармливание.");
    }
    if (isYes(profile.eatingDisorder)) {
      red = true;
      reasons.push("Текущее или прошлое расстройство пищевого поведения.");
    }
    if (isYes(profile.acuteSymptoms)) {
      red = true;
      emergency = true;
      reasons.push("Симптомы, требующие осторожности: боль в груди, обморок, головокружение, слабость или выраженная одышка.");
    }
    if (isYes(profile.surgeryInjury)) {
      red = true;
      reasons.push("Недавняя операция или острая травма.");
    }
    if (isYes(profile.bp) && profile.bpControlled === "no") {
      red = true;
      reasons.push("Повышенное давление без контроля.");
    }
    if (isYes(profile.cardiovascular) && (profile.cvUnstable === "yes" || profile.cvUnstable === "unknown")) {
      red = true;
      reasons.push("Сердечно-сосудистое заболевание с признаками нестабильности или неопределённости.");
    }

    if (profile.age >= 65) yellow.push("Возраст 65 лет и старше.");
    if (bmi >= 35) yellow.push("Существенное повышение ИМТ.");
    if (isYes(profile.meds)) yellow.push("Лекарства, которые могут влиять на вес или нагрузку.");
    if (isYes(profile.jointBack) || isYes(profile.jointKnees) || isYes(profile.jointHips) || isYes(profile.jointOther)) {
      yellow.push("Суставные ограничения или боли.");
    }
    if (isYes(profile.bp) && profile.bpControlled !== "no") yellow.push("Повышенное давление.");
    if (isYes(profile.diabetes)) yellow.push("Диабет или предиабет.");
    if (isYes(profile.cardiovascular) && !red) yellow.push("Сердечно-сосудистое заболевание.");
    if (isYes(profile.kidneyLiverGi)) yellow.push("Заболевания почек, печени или ЖКТ.");
    if (isYes(profile.thyroid)) yellow.push("Заболевание щитовидной железы.");
    if (profile.trainingExperience === "none" || profile.trainingExperience === "long-break") {
      yellow.push("Нет опыта тренировок или длительный перерыв.");
    }
    if ((profile.diseasesComment || "").trim()) yellow.push("Дополнительные ограничения, указанные в комментарии.");

    const medicalNutritionCaution = isYes(profile.diabetes) || isYes(profile.kidneyLiverGi);
    const jointLimit = isYes(profile.jointBack) || isYes(profile.jointKnees) || isYes(profile.jointHips) || isYes(profile.jointOther);
    const lowImpact = red || jointLimit || bmi >= 35 || profile.trainingExperience === "none" || profile.age >= 65;
    const blocksDeficit = red || underage || bmi < 18.5;

    let level = "green";
    if (red) level = "red";
    else if (yellow.length) level = "yellow";

    return {
      level: level,
      reasons: reasons.concat(level === "red" ? [] : yellow),
      yellowReasons: yellow,
      redReasons: reasons,
      emergency: emergency,
      blocksDeficit: blocksDeficit,
      medicalNutritionCaution: medicalNutritionCaution,
      noHIIT: level !== "green" || jointLimit || bmi >= 30 || profile.trainingExperience === "none",
      lowImpact: lowImpact,
      underage: underage
    };
  }

  function targetIsUnsafe(profile) {
    const minWeight = weightForBMI(profile.heightCm, 18.5);
    return profile.targetWeightKg < minWeight - 0.2;
  }

  /* ---------- программа ---------- */

  function buildProgram(profile, isDemo) {
    const safety = assessSafety(profile);
    const bmi = calcBMI(profile.weightKg, profile.heightCm);
    const bmr = calcBMR(profile.weightKg, profile.heightCm, profile.age, profile.sex);
    const tdee = calcTDEE(bmr, profile.activityLevel);
    const canDeficit = !safety.blocksDeficit;
    const calories = calcCalorieRange(tdee, profile.sex, canDeficit);
    const unsafeTarget = targetIsUnsafe(profile);
    const effectiveTarget = unsafeTarget ? Math.round(weightForBMI(profile.heightCm, 18.5) * 10) / 10 : profile.targetWeightKg;
    const diff = calcWeightDiff(profile.weightKg, effectiveTarget);
    const weeks = canDeficit && diff > 0 ? calcTimeRangeWeeks(diff) : { min: null, max: null };
    const changePct = calcWeightChangePercent(profile.weightKg, effectiveTarget);
    const whr = calcWaistToHeight(profile.waistCm, profile.heightCm);
    const stepsGoal = calcStepsGoal(profile.avgSteps, safety.level);
    const midGoal = canDeficit ? calcIntermediateGoal(profile.weightKg, effectiveTarget, profile.heightCm) : null;
    const sessions = Math.max(1, Math.min(Number(profile.sessionsPerWeek) || 3, 5));

    const program = {
      safety: safety,
      bmi: bmi,
      bmiCategory: getBMICategory(bmi),
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      calories: calories,
      weightDiff: diff,
      weeks: weeks,
      changePct: changePct,
      waistToHeight: whr,
      stepsGoal: stepsGoal,
      intermediateGoal: midGoal,
      effectiveTarget: effectiveTarget,
      unsafeTarget: unsafeTarget,
      sessionsPerWeek: safety.level === "red" ? 0 : sessions,
      sessionMinutes: Number(profile.sessionMinutes) || 30,
      activityLabel: recommendActivity(profile, safety)
    };

    const nutrition = safety.level === "red" || safety.underage ? null : buildMealPlan(profile, program, String(profile.mealsPerDay || "3"));
    const training = safety.level === "red" || safety.underage ? null : buildWorkoutPlan(profile, program);

    return {
      isDemo: !!isDemo,
      createdAt: isoDate(new Date()),
      profile: profile,
      program: program,
      nutrition: nutrition,
      training: training
    };
  }

  function recommendActivity(profile, safety) {
    if (safety.level === "red") return "Только бытовая активность, которую разрешил врач.";
    if (safety.lowImpact) return "Ходьба в разговорном темпе и силовые упражнения без прыжков.";
    if (profile.preferredActivity === "walking") return "Ходьба и 1–2 короткие силовые сессии.";
    if (profile.location === "gym") return "Силовые упражнения в зале в умеренном темпе и ходьба.";
    return "Смешанная активность: ходьба и силовые упражнения дома или на улице.";
  }

  /* ---------- питание ---------- */

  function recipeAllowed(recipe, profile, strictBudget) {
    if (profile.dietType === "vegan" && !recipe.vegan) return false;
    if (profile.dietType === "vegetarian" && !recipe.vegetarian) return false;
    const allergies = profile.allergies || [];
    if (recipe.allergens.some(function (a) { return allergies.indexOf(a) !== -1; })) return false;
    const extra = (profile.allergyComment || "").toLowerCase();
    const hay = (recipe.name + " " + recipe.ingredients.map(function (i) { return i.name; }).join(" ")).toLowerCase();
    if (extra && extra.length > 2 && hay.indexOf(extra) !== -1) return false;
    const excluded = String(profile.excludedFoods || "").toLowerCase().split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (excluded.some(function (word) { return hay.indexOf(word) !== -1; })) return false;
    if (strictBudget && profile.budget === "low" && recipe.budget === "comfortable") return false;
    if (strictBudget && profile.cookingTime === "15" && recipe.cook === "medium") return false;
    return true;
  }

  function availableRecipes(profile) {
    var list = APP_DATA.recipes.filter(function (r) { return recipeAllowed(r, profile, true); });
    if (list.length < 8) list = APP_DATA.recipes.filter(function (r) { return recipeAllowed(r, profile, false); });
    return list;
  }

  function scaleRecipe(recipe, targetKcal) {
    var k = targetKcal / recipe.kcal;
    k = Math.min(Math.max(k, 0.7), 1.35);
    return {
      id: recipe.id,
      name: recipe.name,
      meal: recipe.meal,
      portion: recipe.portion,
      method: recipe.method,
      swaps: recipe.swaps.slice(),
      ingredients: recipe.ingredients,
      kcal: Math.round(recipe.kcal * k),
      protein: Math.round(recipe.protein * k),
      fat: Math.round(recipe.fat * k),
      carbs: Math.round(recipe.carbs * k),
      scale: k
    };
  }

  function pickRecipe(pool, meal, used) {
    var options = pool.filter(function (r) { return r.meal === meal; });
    if (!options.length) options = pool.slice();
    var fresh = options.filter(function (r) { return used.indexOf(r.id) === -1; });
    var list = fresh.length ? fresh : options;
    return list[Math.floor(Math.random() * list.length)] || APP_DATA.recipes[0];
  }

  function mealSlots(pattern) {
    if (pattern === "5" || pattern === "3+2") return ["breakfast", "lunch", "snack", "dinner", "snack"];
    if (pattern === "4" || pattern === "3+1") return ["breakfast", "lunch", "snack", "dinner"];
    return ["breakfast", "lunch", "dinner"];
  }

  function calorieShares(count) {
    if (count === 5) return [0.25, 0.3, 0.1, 0.25, 0.1];
    if (count === 4) return [0.25, 0.35, 0.15, 0.25];
    return [0.3, 0.4, 0.3];
  }

  function buildMealPlan(profile, program, pattern) {
    var slots = mealSlots(pattern);
    var shares = calorieShares(slots.length);
    var target = program.calories.blocked ? program.tdee : Math.round((program.calories.min + program.calories.max) / 2);
    var pool = availableRecipes(profile);
    var days = [];
    var used = [];
    for (var d = 0; d < 7; d++) {
      var meals = slots.map(function (slot, i) {
        var recipe = pickRecipe(pool, slot, used);
        used.push(recipe.id);
        if (used.length > 10) used.shift();
        return scaleRecipe(recipe, Math.round(target * shares[i]));
      });
      days.push({ title: DAY_NAMES[d], meals: meals });
    }
    return {
      pattern: pattern,
      days: days,
      shoppingChecked: {}
    };
  }

  function replaceMeal(dayIndex, mealIndex) {
    var profile = state.profile;
    var meal = state.nutrition.days[dayIndex].meals[mealIndex];
    var pool = availableRecipes(profile).filter(function (r) {
      return r.meal === meal.meal && r.id !== meal.id;
    });
    if (!pool.length) pool = availableRecipes(profile).filter(function (r) { return r.id !== meal.id; });
    if (!pool.length) {
      toast("Подходящая замена не найдена с учётом ограничений.");
      return;
    }
    var next = pool[Math.floor(Math.random() * pool.length)];
    state.nutrition.days[dayIndex].meals[mealIndex] = scaleRecipe(next, meal.kcal);
    saveState();
    renderNutrition();
    toast("Блюдо заменено.");
  }

  function collectShopping() {
    if (!state.nutrition) return [];
    var map = {};
    state.nutrition.days.forEach(function (day) {
      day.meals.forEach(function (meal) {
        meal.ingredients.forEach(function (ing) {
          var key = ing.name + "|" + ing.category;
          if (!map[key]) map[key] = { name: ing.name, category: ing.category, amounts: [] };
          map[key].amounts.push(ing.amount);
        });
      });
    });
    return Object.keys(map).map(function (key) {
      var item = map[key];
      return {
        id: key,
        name: item.name,
        category: item.category,
        amount: item.amounts.join(", "),
        checked: !!(state.nutrition.shoppingChecked && state.nutrition.shoppingChecked[key])
      };
    });
  }

  /* ---------- тренировки ---------- */

  function weekdayPattern(count) {
    var table = {
      1: [2],
      2: [1, 4],
      3: [0, 2, 4],
      4: [0, 1, 3, 5],
      5: [0, 1, 2, 4, 5],
      6: [0, 1, 2, 3, 4, 5],
      7: [0, 1, 2, 3, 4, 5, 6]
    };
    return table[count] || table[3];
  }

  function trainingLevel(profile, safety) {
    if (safety.lowImpact || safety.level === "yellow") return "beginner";
    if (profile.trainingExperience === "advanced" && profile.sessionsPerWeek >= 4) return "prepared";
    if (profile.trainingExperience === "intermediate") return "intermediate";
    return "beginner";
  }

  function exercisePool(profile, safety) {
    if (safety.lowImpact || safety.level === "yellow") return APP_DATA.exercises.lowImpact;
    if (profile.location === "gym") return APP_DATA.exercises.gym;
    if ((profile.equipment || []).indexOf("dumbbells") !== -1) return APP_DATA.exercises.homeDumbbells;
    if ((profile.equipment || []).indexOf("bands") !== -1) return APP_DATA.exercises.homeBands;
    if (profile.location === "outdoor" || profile.preferredActivity === "walking") return APP_DATA.exercises.walk.concat(APP_DATA.exercises.homeNone.slice(0, 3));
    return APP_DATA.exercises.homeNone;
  }

  function filterAvoid(list, profile) {
    var avoid = [];
    if (isYes(profile.jointKnees)) avoid.push("knees");
    if (isYes(profile.jointBack)) avoid.push("back");
    if (isYes(profile.jointHips)) avoid.push("hips");
    return list.filter(function (ex) {
      return !(ex.avoid || []).some(function (a) { return avoid.indexOf(a) !== -1; });
    });
  }

  function buildWorkoutPlan(profile, program) {
    var safety = program.safety;
    var level = trainingLevel(profile, safety);
    var minutes = program.sessionMinutes;
    var days = weekdayPattern(program.sessionsPerWeek);
    var pool = filterAvoid(exercisePool(profile, safety), profile);
    if (pool.length < 3) pool = APP_DATA.exercises.lowImpact;
    var start = isoDate(new Date());
    var sessions = [];
    var names = { beginner: "Начинающий", intermediate: "Средний", prepared: "Подготовленный" };

    for (var week = 1; week <= 4; week++) {
      var setHint = week === 1 ? "2 подхода" : week === 2 ? "2–3 подхода" : "3 подхода, если самочувствие позволяет";
      days.forEach(function (wd, idx) {
        var date = addDays(start, (week - 1) * 7 + wd);
        var isWalk = safety.lowImpact || profile.preferredActivity === "walking" || idx % 2 === 1 && profile.location === "outdoor";
        var main = isWalk ? APP_DATA.exercises.walk : pool;
        var picked = main.slice(0, Math.min(main.length, week === 1 ? 3 : 4));
        sessions.push({
          id: date + "-" + week,
          date: date,
          week: week,
          title: isWalk ? "Ходьба и лёгкая сила" : "Силовая тренировка",
          level: names[level],
          duration: minutes,
          rpe: safety.lowImpact ? "3–5" : level === "beginner" ? "4–6" : "5–7",
          setsHint: setHint,
          warmup: APP_DATA.exercises.warmup,
          main: picked,
          cooldown: APP_DATA.exercises.cooldown,
          note: "Прекратите упражнение при боли, головокружении или резком ухудшении самочувствия."
        });
      });
    }

    return {
      level: level,
      levelLabel: names[level],
      sessions: sessions,
      log: {}
    };
  }

  function consecutiveTrainingFlags() {
    if (!state.training) return { hard: 0, pain: 0 };
    var dates = Object.keys(state.training.log).sort();
    var hard = 0;
    var pain = 0;
    for (var i = dates.length - 1; i >= 0; i--) {
      var entry = state.training.log[dates[i]];
      if (entry.pain === "yes") pain += 1;
      else break;
    }
    for (var j = dates.length - 1; j >= 0; j--) {
      var item = state.training.log[dates[j]];
      if (Number(item.rpe) >= 8) hard += 1;
      else break;
    }
    return { hard: hard, pain: pain };
  }

  /* ---------- привычки ---------- */

  function ensureHabitWeek() {
    var current = mondayOf(new Date());
    if (state.habits.weekStart !== current) {
      state.habits.weekStart = current;
      saveState();
    }
  }

  /* ---------- корректировка ---------- */

  function analyzeWeek() {
    if (!state.program || state.program.safety.level === "red") return null;
    var diary = state.diary || [];
    if (diary.length < 3) return null;
    var today = isoDate(new Date());
    var from = addDays(today, -6);
    var entries = (state.diary || []).filter(function (e) { return e.date >= from && e.date <= today; });
    var weights = entries.map(function (e) { return Number(e.weight); }).filter(function (n) { return n > 0; });
    var avg = weights.length ? weights.reduce(function (a, b) { return a + b; }, 0) / weights.length : null;
    var energyLow = entries.filter(function (e) { return e.energy === "low"; }).length;
    var hungerHigh = entries.filter(function (e) { return e.hunger === "high"; }).length;
    var startW = Number(state.profile.weightKg);
    var change = avg ? startW - avg : null;
    var weeksRunning = Math.max(1, Math.round((Date.now() - new Date(state.createdAt).getTime()) / 604800000));
    var weeklyRate = change !== null ? change / weeksRunning : null;

    var type = "keep";
    var text = "Если среднее значение веса постепенно снижается, а самочувствие обычное, текущий план можно сохранить. Это ориентир, а не диагноз.";
    if (weeklyRate !== null && weeklyRate > 0.75 || energyLow >= 3 || hungerHigh >= 3) {
      type = "ease";
      text = "Снижение выглядит быстрым либо есть сильный голод или усталость. Имеет смысл увеличить калорийность и чуть снизить нагрузку после обсуждения с врачом или нутрициологом.";
    } else if (weeksRunning >= 2 && weeklyRate !== null && weeklyRate < 0.1) {
      type = "review";
      text = "Заметной динамики пока нет. Сначала проверьте полноту записей, шаги, сон, размер порций и регулярность тренировок. Калорийность автоматически не снижается.";
    }
    return { type: type, text: text, avg: avg, weeklyRate: weeklyRate, entries: entries.length };
  }

  /* ---------- UI-утилиты ---------- */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function toast(message) {
    var el = $("#toast");
    el.hidden = true;
    void el.offsetWidth;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme || "light");
    var toggle = $("#theme-toggle");
    if (toggle) {
      var dark = state.theme === "dark";
      toggle.setAttribute("aria-pressed", dark ? "true" : "false");
      toggle.textContent = dark ? "Тень" : "Свет";
    }
  }

  function hasProgram() {
    return !!(state.profile && state.program);
  }

  function showView(name) {
    $all("[data-view]").forEach(function (view) {
      view.hidden = view.getAttribute("data-view") !== name;
      view.classList.remove("is-entering");
    });
    $all("[data-nav]").forEach(function (link) {
      var active = link.getAttribute("data-nav") === name;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.body.setAttribute("data-screen", name);
    moreOpen = false;
    var more = $("#more-sheet");
    if (more) more.hidden = true;
    if (window.history && history.replaceState) {
      history.replaceState(null, "", "#" + name);
    }
    window.scrollTo(0, 0);
    if (name === "program") renderProgram();
    if (name === "nutrition") renderNutrition();
    if (name === "workouts") renderWorkouts();
    if (name === "habits") renderHabits();
    if (name === "progress") renderProgress();
    if (name === "materials") renderMaterials();
    if (name === "settings") renderSettings();
    if (name === "limited") renderLimited();
    if (name === "home") refreshChrome();
    var activeView = document.querySelector('[data-view="' + name + '"]');
    if (activeView) {
      void activeView.offsetWidth;
      activeView.classList.add("is-entering");
      enhanceFoldHeadings(activeView, name);
      animateViewContent(activeView, name);
    }
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function animateViewContent(root, sectionName) {
    if (!root) return;
    var reduce = prefersReducedMotion();
    var selector = [
      ".cards > *",
      ".panel",
      ".meal-card",
      ".session-card",
      ".day-block",
      ".notice",
      ".habit-table-wrap",
      ".charts > *",
      ".settings-actions",
      ".btn-row",
      ".btn-stack",
      ".segmented",
      ".toolbar",
      ".empty",
      ".diary-list > li",
      ".quiz"
    ].join(", ");

    var nodes = root.querySelectorAll(selector);
    Array.prototype.forEach.call(nodes, function (el, i) {
      el.classList.remove("is-revealed");
      el.classList.add("reveal-item");
      el.style.setProperty("--reveal-i", String(Math.min(i, 12)));
      if (reduce) {
        el.classList.add("is-revealed");
        return;
      }
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          el.classList.add("is-revealed");
        });
      });
    });

    if (sectionName === "home") {
      animateHomeExtras(root, reduce);
    }
  }

  function animateHomeExtras(root, reduce) {
    var actions = root.querySelector(".hero-actions");
    if (actions) {
      actions.classList.remove("is-ready");
      if (reduce) {
        actions.classList.add("is-ready");
      } else {
        window.setTimeout(function () {
          actions.classList.add("is-ready");
        }, 280);
      }
    }

    var steps = root.querySelectorAll(".steps li");
    Array.prototype.forEach.call(steps, function (el, i) {
      el.classList.add("reveal-item");
      el.classList.remove("is-revealed");
      el.style.setProperty("--reveal-i", String(i));
      if (reduce) el.classList.add("is-revealed");
    });

    setupHomeScrollObserver(root, reduce);
  }

  var homeScrollObserver = null;

  function setupHomeScrollObserver(root, reduce) {
    if (homeScrollObserver) {
      homeScrollObserver.disconnect();
      homeScrollObserver = null;
    }
    var how = root.querySelector(".how");
    if (!how) return;
    how.classList.remove("is-inview");

    if (reduce || !("IntersectionObserver" in window)) {
      how.classList.add("is-inview");
      Array.prototype.forEach.call(root.querySelectorAll(".steps li"), function (el) {
        el.classList.add("is-revealed");
      });
      return;
    }

    homeScrollObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          how.classList.add("is-inview");
          Array.prototype.forEach.call(root.querySelectorAll(".steps li"), function (el) {
            el.classList.add("is-revealed");
          });
          homeScrollObserver.disconnect();
          homeScrollObserver = null;
        });
      },
      { threshold: 0.28, rootMargin: "0px 0px -8% 0px" }
    );
    homeScrollObserver.observe(how);
  }

  function enhanceFoldHeadings(root, sectionName) {
    // FoldText только на главном заголовке главной страницы
    if (!root || sectionName !== "home") return;
    var h1 = root.querySelector(".hero-title");
    if (h1) mountHeroFoldText(h1);
  }

  /**
   * FoldText (адаптация React Bits): splitBy=char, hinge=top, trigger=mount.
   * Слова в nowrap-обёртках, чтобы буквы одного слова не переносились.
   */
  function mountHeroFoldText(h1) {
    var text = h1.getAttribute("data-fold-text");
    if (!text) {
      text = (h1.textContent || "").replace(/\s+/g, " ").trim();
    }
    if (!text) return;

    var duration = 0.65;
    var stagger = 0.045;
    var perspective = 700;
    var creaseShading = 0.55;
    var hinge = "top";
    var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var activeDuration = reduceMotion ? Math.min(duration, 0.22) : duration;
    var activeStagger = reduceMotion ? Math.min(stagger, 0.02) : stagger;

    h1.setAttribute("data-fold-text", text);
    h1.setAttribute("aria-label", text);
    h1.classList.add("has-fold-text");
    h1.textContent = "";

    var root = document.createElement("span");
    root.className = "fold-text";
    root.style.setProperty("--fold-text-font-weight", "600");
    root.style.setProperty("--fold-text-color", "var(--color-text-primary)");
    root.style.setProperty("--fold-perspective", perspective + "px");

    var sr = document.createElement("span");
    sr.className = "fold-text-sr-only";
    sr.textContent = text;
    root.appendChild(sr);

    var visual = document.createElement("span");
    visual.className = "fold-text-visual";
    visual.setAttribute("aria-hidden", "true");

    var hingeOrigins = {
      top: "50% 0%",
      bottom: "50% 100%",
      left: "0% 50%",
      right: "100% 50%"
    };
    var origin = hingeOrigins[hinge];
    var index = 0;

    text.split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        var ws = document.createElement("span");
        ws.className = "fold-text-whitespace";
        ws.textContent = part.replace(/ /g, "\u00A0");
        visual.appendChild(ws);
        return;
      }

      var word = document.createElement("span");
      word.className = "fold-text-word";

      Array.from(part).forEach(function (ch) {
        var segment = document.createElement("span");
        segment.className = "fold-text-segment";
        segment.setAttribute("data-fold-split", "char");
        segment.style.setProperty("--fold-perspective", perspective + "px");

        var piece = document.createElement("span");
        piece.className = "fold-text-piece";
        piece.setAttribute("data-fold-hinge", hinge);
        piece.style.transformOrigin = origin;
        piece.style.setProperty("--fold-crease", reduceMotion ? "0" : String(creaseShading));
        piece.style.animationDuration = activeDuration + "s";
        piece.style.animationDelay = index * activeStagger + "s";
        piece.textContent = ch;
        segment.appendChild(piece);
        word.appendChild(segment);
        index += 1;
      });

      visual.appendChild(word);
    });

    root.appendChild(visual);
    h1.appendChild(root);

    void root.offsetWidth;
    root.classList.add("is-folding");

    var pieces = root.querySelectorAll(".fold-text-piece");
    var totalMs = Math.round(((Math.max(index, 1) - 1) * activeStagger + activeDuration) * 1000) + 80;
    window.setTimeout(function () {
      Array.prototype.forEach.call(pieces, function (piece) {
        piece.classList.add("is-folded");
        piece.style.opacity = "1";
        piece.style.transform = "none";
        piece.style.setProperty("--fold-crease", "0");
      });
    }, totalMs);
  }

  function refreshChrome() {
    var cont = $("#continue-btn");
    if (cont) {
      cont.hidden = !hasProgram();
      var limited = hasProgram() && (state.program.safety.level === "red" || state.program.safety.underage);
      cont.setAttribute("data-view-link", limited ? "limited" : "program");
    }
    var appNav = $("#app-nav");
    var bottom = $("#bottom-nav");
    var more = $("#more-sheet");
    // Верхнее меню всегда доступно; разделы сами показывают пустое состояние без программы
    if (appNav) appNav.hidden = false;
    if (bottom) bottom.hidden = true;
    if (more) more.hidden = true;
    moreOpen = false;
    document.body.classList.toggle("has-app-nav", true);
    var demoBanner = $("#demo-banner");
    if (demoBanner) demoBanner.hidden = !state.isDemo;
  }

  function openModal(html) {
    var modal = $("#modal");
    $("#modal-content").innerHTML = html;
    modal.hidden = false;
    var focusable = modal.querySelector("button, [href], input, select, textarea");
    if (focusable) focusable.focus();
  }

  function closeModal() {
    $("#modal").hidden = true;
  }

  /* ---------- анкета ---------- */

  function renderHealthFields() {
    var box = $("#health-fields");
    if (!box) return;
    box.innerHTML = HEALTH_QUESTIONS.map(function (q) {
      var need = !q.optional;
      return (
        '<fieldset class="choice-set">' +
          '<legend>' + q.label + (need ? "" : " <span class=\"muted\">необязательно</span>") + "</legend>" +
          '<div class="choice-row" role="radiogroup" aria-label="' + q.label + '">' +
            radio(q.id, "yes", "Да", need) +
            radio(q.id, "no", "Нет", need) +
            radio(q.id, "unknown", "Не знаю", need) +
          "</div>" +
          '<label class="field-note">Комментарий, если хотите уточнить' +
            '<textarea name="' + q.id + 'Comment" rows="2" maxlength="400"></textarea>' +
          "</label>" +
        "</fieldset>"
      );
    }).join("");
  }

  function radio(name, value, label, required) {
    return (
      '<label class="chip">' +
        '<input type="radio" name="' + name + '" value="' + value + '"' + (required ? " required" : "") + ">" +
        "<span>" + label + "</span>" +
      "</label>"
    );
  }

  function setQuizStep(step, opts) {
    opts = opts || {};
    var prev = quizStep;
    var animate = opts.animate !== false && prev !== step;
    var goingNext = step > prev;
    quizStep = step;
    $all(".quiz-panel").forEach(function (panel) {
      var panelStep = Number(panel.getAttribute("data-step"));
      var isTarget = panelStep === step;
      panel.classList.remove("is-slide-in-next", "is-slide-in-prev");
      panel.hidden = !isTarget;
      if (isTarget && animate) {
        void panel.offsetWidth;
        panel.classList.add(goingNext ? "is-slide-in-next" : "is-slide-in-prev");
      }
    });
    $all(".progress-step").forEach(function (el, i) {
      el.classList.toggle("is-done", i + 1 < step);
      el.classList.toggle("is-current", i + 1 === step);
    });
    $("#quiz-progress-label").textContent = "Шаг " + step + " из 5";
    $("#quiz-bar").style.width = (step / 5) * 100 + "%";
  }

  function gatherQuiz(form) {
    var data = new FormData(form);
    var get = function (name) { return String(data.get(name) || "").trim(); };
    var allergies = $all("input[name='allergies']:checked").map(function (el) { return el.value; });
    var equipment = $all("input[name='equipment']:checked").map(function (el) { return el.value; });
    if (!equipment.length) equipment = ["none"];
    return {
      name: get("name"),
      age: Number(get("age")),
      sex: get("sex"),
      heightCm: Number(get("heightCm")),
      weightKg: Number(get("weightKg")),
      targetWeightKg: Number(get("targetWeightKg")),
      waistCm: Number(get("waistCm")),
      activityLevel: get("activityLevel"),
      avgSteps: Number(get("avgSteps")),
      trainingExperience: get("trainingExperience"),
      sessionsPerWeek: Number(get("sessionsPerWeek")),
      sessionMinutes: Number(get("sessionMinutes")),
      location: get("location"),
      equipment: equipment,
      preferredActivity: get("preferredActivity"),
      workType: get("workType"),
      sleepHours: Number(get("sleepHours")),
      stressLevel: get("stressLevel"),
      eatingPattern: get("eatingPattern"),
      mealsPerDay: get("mealsPerDay"),
      foodPreferences: get("foodPreferences"),
      excludedFoods: get("excludedFoods"),
      allergies: allergies,
      allergyComment: get("allergyComment"),
      dietType: get("dietType"),
      budget: get("budget"),
      cookingTime: get("cookingTime"),
      diseasesComment: get("diseasesComment"),
      meds: get("meds"),
      medsComment: get("medsComment"),
      jointBack: get("jointBack"),
      jointBackComment: get("jointBackComment"),
      jointKnees: get("jointKnees"),
      jointKneesComment: get("jointKneesComment"),
      jointHips: get("jointHips"),
      jointHipsComment: get("jointHipsComment"),
      jointOther: get("jointOther"),
      jointOtherComment: get("jointOtherComment"),
      bp: get("bp"),
      bpComment: get("bpComment"),
      bpControlled: get("bpControlled") || "unknown",
      bpControlledComment: get("bpControlledComment"),
      diabetes: get("diabetes"),
      diabetesComment: get("diabetesComment"),
      cardiovascular: get("cardiovascular"),
      cardiovascularComment: get("cardiovascularComment"),
      cvUnstable: get("cvUnstable") || "unknown",
      cvUnstableComment: get("cvUnstableComment"),
      kidneyLiverGi: get("kidneyLiverGi"),
      kidneyLiverGiComment: get("kidneyLiverGiComment"),
      thyroid: get("thyroid"),
      thyroidComment: get("thyroidComment"),
      pregnancy: get("pregnancy"),
      pregnancyComment: get("pregnancyComment"),
      breastfeeding: get("breastfeeding"),
      breastfeedingComment: get("breastfeedingComment"),
      eatingDisorder: get("eatingDisorder"),
      eatingDisorderComment: get("eatingDisorderComment"),
      surgeryInjury: get("surgeryInjury"),
      surgeryInjuryComment: get("surgeryInjuryComment"),
      acuteSymptoms: get("acuteSymptoms"),
      acuteSymptomsComment: get("acuteSymptomsComment")
    };
  }

  function validateQuizStep(form, step) {
    var panel = form.querySelector('.quiz-panel[data-step="' + step + '"]');
    var fields = $all("input, select, textarea", panel);
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    if (step === 1) {
      var age = Number(form.age.value);
      var height = Number(form.heightCm.value);
      var weight = Number(form.weightKg.value);
      var target = Number(form.targetWeightKg.value);
      var waist = Number(form.waistCm.value);
      if (age < 1 || age > 120) return fail(form.age, "Укажите возраст от 1 до 120 лет.");
      if (height < 120 || height > 230) return fail(form.heightCm, "Укажите рост в пределах 120–230 см.");
      if (weight <= 0 || weight > 300) return fail(form.weightKg, "Вес должен быть больше 0.");
      if (target <= 0 || target > 300) return fail(form.targetWeightKg, "Желаемый вес не может быть равен нулю или отрицательным.");
      if (waist <= 0 || waist > 200) return fail(form.waistCm, "Укажите обхват талии больше 0.");
    }
    if (step === 5 && !form.consent.checked) {
      return fail(form.consent, "Чтобы продолжить, подтвердите информационный характер программы.");
    }
    return true;
  }

  function fail(field, message) {
    field.setCustomValidity(message);
    field.reportValidity();
    field.setCustomValidity("");
    return false;
  }

  function applyBuiltProgram(built, isDemo) {
    state = Object.assign(createEmptyState(), {
      consent: true,
      isDemo: isDemo,
      createdAt: built.createdAt,
      profile: built.profile,
      program: built.program,
      nutrition: built.nutrition,
      training: built.training,
      habits: { weekStart: mondayOf(new Date()), checks: {} },
      diary: isDemo ? demoDiary(built.profile) : [],
      theme: state.theme || "light"
    });
    saveState();
    refreshChrome();
    if (built.program.safety.underage) showView("limited");
    else if (built.program.safety.level === "red") showView("limited");
    else showView("program");
    toast(isDemo ? "Загружен демонстрационный пример." : "Программа сохранена на этом устройстве.");
  }

  function demoProfile() {
    return {
      name: "Алексей",
      age: 38,
      sex: "male",
      heightCm: 176,
      weightKg: 89,
      targetWeightKg: 82,
      waistCm: 96,
      activityLevel: "light",
      avgSteps: 4500,
      trainingExperience: "beginner",
      sessionsPerWeek: 3,
      sessionMinutes: 30,
      location: "home",
      equipment: ["none"],
      preferredActivity: "mixed",
      workType: "sedentary",
      sleepHours: 7,
      stressLevel: "medium",
      eatingPattern: "irregular",
      mealsPerDay: "3",
      foodPreferences: "привычная домашняя еда, без острых ограничений",
      excludedFoods: "",
      allergies: [],
      allergyComment: "",
      dietType: "regular",
      budget: "medium",
      cookingTime: "30",
      diseasesComment: "",
      meds: "no",
      jointBack: "no",
      jointKnees: "no",
      jointHips: "no",
      jointOther: "no",
      bp: "no",
      bpControlled: "unknown",
      diabetes: "no",
      cardiovascular: "no",
      cvUnstable: "unknown",
      kidneyLiverGi: "no",
      thyroid: "no",
      pregnancy: "no",
      breastfeeding: "no",
      eatingDisorder: "no",
      surgeryInjury: "no",
      acuteSymptoms: "no"
    };
  }

  function demoDiary(profile) {
    var list = [];
    for (var i = 6; i >= 0; i--) {
      var date = addDays(isoDate(new Date()), -i);
      list.push({
        date: date,
        weight: Math.round((profile.weightKg - i * 0.05) * 10) / 10,
        waist: profile.waistCm,
        steps: 4300 + i * 120,
        workout: i % 2 === 0 ? "partial" : "yes",
        meals: "mostly",
        sleep: 7,
        energy: i === 2 ? "medium" : "ok",
        mood: "ok",
        hunger: "medium",
        notes: i === 6 ? "Демонстрационная запись" : ""
      });
    }
    return list;
  }

  /* ---------- отрисовка экранов ---------- */

  function safetyBadge(level) {
    var map = {
      green: ["badge-green", "Зелёный уровень"],
      yellow: ["badge-yellow", "Жёлтый уровень"],
      red: ["badge-red", "Красный уровень"]
    };
    var item = map[level] || map.green;
    return '<span class="badge ' + item[0] + '">' + item[1] + "</span>";
  }

  function renderProgram() {
    var root = $("#view-program");
    if (!hasProgram()) {
      root.innerHTML = emptyBlock("Сначала заполните анкету или откройте пример.", "Составить программу", "quiz");
      return;
    }
    var p = state.program;
    var profile = state.profile;
    if (p.safety.level === "red" || p.safety.underage) {
      showView("limited");
      return;
    }
    var calText = p.calories.blocked
      ? "Дефицит не рассчитан. Обсудите питание со специалистом."
      : (p.safety.medicalNutritionCaution
        ? "Цифры не назначаются: сначала согласуйте рацион со специалистом"
        : p.calories.min + "–" + p.calories.max + " ккал");
    var weekText = p.weeks.min ? p.weeks.min + "–" + p.weeks.max + " недель" : "не рассчитывается";
    var review = analyzeWeek();
    root.innerHTML =
      (state.isDemo ? '<p class="demo-tag">Демонстрационный пример, не ваши данные</p>' : "") +
      "<h1>Моя программа</h1>" +
      '<p class="lead">Ориентировочный расчёт для ' + escapeHtml(profile.name) + ". Это информационная рекомендация, а не назначение врача.</p>" +
      (p.safety.level === "yellow" ? '<div class="notice notice-yellow"><strong>Жёлтый уровень безопасности.</strong> Перед началом обсудите программу с врачом. Интенсивные интервалы не используются. Нагрузка низкая или умеренная.' + (p.safety.medicalNutritionCaution ? " При заболеваниях, требующих лечебного питания, жёстких рекомендаций по калорийности и БЖУ нет: рацион нужно согласовать со специалистом." : "") + "</div>" : "") +
      (p.unsafeTarget ? '<div class="notice">Желаемый вес соответствует ИМТ ниже 18,5. Он не используется как цель. Обсудите ориентир со специалистом.</div>' : "") +
      (p.calories.consult ? '<div class="notice">Расчётный дефицит опускался бы ниже защитного значения. Цифра ниже ' + p.calories.floor + " ккал не показывается. Нужна консультация врача или диетолога.</div>" : "") +
      (p.calories.usedFloor ? '<div class="notice">Калорийность не опущена ниже ориентировочного защитного значения ' + p.calories.floor + " ккал.</div>" : "") +
      '<div class="cards">' +
        card("ИМТ", p.bmi.toFixed(1), p.bmiCategory.label + ". ИМТ — ориентир, он не учитывает мышечную массу, беременность, телосложение и распределение жировой ткани.") +
        card("Основной обмен", p.bmr + " ккал", "Формула Миффлина — Сан Жеора, ориентировочный расчёт.") +
        card("Суточный расход", p.tdee + " ккал", "Основной обмен, умноженный на коэффициент активности.") +
        card("Калорийность", calText, "Умеренный дефицит около 10–20% от расхода, если нет противопоказаний.") +
        card("Темп снижения", "около 0,25–0,75 кг в неделю", "Реальная динамика нелинейна и зависит от здоровья, сна, лекарств, питания и активности.") +
        card("Промежуточная цель", p.intermediateGoal ? p.intermediateGoal + " кг" : "не задана", "Сначала небольшое изменение, около 3–5% от исходного веса, если это безопасно.") +
        card("Уровень безопасности", safetyBadge(p.safety.level), (p.safety.yellowReasons || p.safety.reasons).join(" ") || "Серьёзных ограничений по анкете не отмечено.") +
        card("Активность", p.activityLabel, "При ухудшении самочувствия прекратите тренировку.") +
        card("Тренировки", p.sessionsPerWeek + " в неделю по " + p.sessionMinutes + " мин", "Объём подобран по анкете и будет расти постепенно.") +
        card("Шаги", p.stepsGoal + " в день", "Цель чуть выше вашего текущего среднего, а не обязательные 10 000 шагов.") +
        card("Сон и восстановление", (profile.sleepHours || "—") + " ч, стресс: " + stressLabel(profile.stressLevel), "Восстановление важнее дополнительных подходов.") +
        card("До цели", weekText, "Ориентировочный диапазон времени, не обещание результата.") +
      "</div>" +
      (review ? '<section class="panel"><h2>Короткий отчёт</h2><p>' + review.text + "</p>" + (review.type !== "keep" ? '<div class="btn-row"><button class="btn" type="button" data-action="confirm-adjust" data-type="' + review.type + '">Подтвердить небольшую корректировку</button></div>' : "") + "</section>" : "") +
      '<section class="panel" id="calc-details"><h2>Как выполнен расчёт</h2>' +
        "<ul class='plain'>" +
          "<li>ИМТ = вес (кг) / [рост (м)]² = " + profile.weightKg + " / (" + (profile.heightCm / 100).toFixed(2) + ")².</li>" +
          "<li>Основной обмен (Миффлин — Сан Жеор): 10×вес + 6,25×рост − 5×возраст " + (profile.sex === "male" ? "+ 5" : "− 161") + ".</li>" +
          "<li>Суточный расход ≈ основной обмен × коэффициент активности " + getActivityFactor(profile.activityLevel) + ".</li>" +
          "<li>Соотношение талии к росту: " + (p.waistToHeight ? p.waistToHeight.toFixed(2) : "недостаточно данных") + ".</li>" +
          "<li>Разница текущего и целевого веса: " + p.weightDiff.toFixed(1) + " кг (" + p.changePct.toFixed(1) + "%).</li>" +
        "</ul></section>";
  }

  function card(title, value, text) {
    return '<article class="stat-card"><h2>' + title + "</h2><p class='stat-value'>" + value + "</p><p>" + text + "</p></article>";
  }

  function stressLabel(v) {
    return { low: "низкий", medium: "средний", high: "высокий" }[v] || "не указан";
  }

  function emptyBlock(text, actionLabel, view) {
    return '<div class="empty"><p>' + text + '</p><button class="btn" type="button" data-view-link="' + view + '">' + actionLabel + "</button></div>";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function renderLimited() {
    var root = $("#view-limited");
    var p = state.program || { safety: { underage: false, emergency: false, redReasons: [] } };
    var title = p.safety.underage
      ? "Программа для взрослых здесь не составляется"
      : "Стандартная программа может не подойти";
    var body = p.safety.underage
      ? "Сайт предназначен только для совершеннолетних. Если вам меньше 18 лет, обсудите питание и активность с педиатром или профильным специалистом вместе с родителями. Дефицит калорий и план похудения не рассчитываются."
      : "По вашим ответам стандартная программа снижения веса может вам не подойти. Пожалуйста, обсудите питание и физическую активность с врачом. До консультации можно использовать только нейтральные рекомендации: соблюдать режим сна, вести дневник самочувствия и поддерживать разрешённую врачом бытовую активность.";
    var extra = p.safety.emergency
      ? '<div class="notice notice-red">Если есть боль в груди, обморок, внезапная слабость или затруднение дыхания, прекратите нагрузку и обратитесь за медицинской помощью. Приложение не определяет причину симптома.</div>'
      : "";
    root.innerHTML =
      "<h1>" + title + "</h1><p class='lead'>" + body + "</p>" + extra +
      (p.safety.redReasons && p.safety.redReasons.length ? "<ul class='plain'>" + p.safety.redReasons.map(function (r) { return "<li>" + escapeHtml(r) + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="cards">' +
        card("Сон", "Стабильный режим", "Ложитесь и вставайте в близкое время, если это возможно.") +
        card("Дневник", "Самочувствие", "Можно отмечать сон, настроение и бытовую активность без цели похудения.") +
        card("Движение", "По разрешению врача", "Не добавляйте тренировки, пока специалист не подтвердит безопасность.") +
      "</div>" +
      '<div class="btn-row"><button class="btn" type="button" data-view-link="progress">Открыть дневник самочувствия</button><button class="btn btn-ghost" type="button" data-view-link="safety">Раздел «Безопасность»</button></div>';
  }

  function renderNutrition() {
    var root = $("#view-nutrition");
    if (!state.nutrition) {
      root.innerHTML = hasProgram()
        ? '<h1>Питание</h1><p>Полноценное меню не сформировано из-за ограничений безопасности. Согласуйте рацион с врачом.</p>'
        : emptyBlock("Меню появится после анкеты.", "Составить программу", "quiz");
      return;
    }
    var caution = state.program.safety.medicalNutritionCaution
      ? '<div class="notice notice-yellow">Есть состояния, при которых питание должно быть лечебным или специально подобранным. Ниже — общий конструктор, а не диета. Согласуйте рацион со специалистом. Жёстких норм БЖУ нет.</div>'
      : "";
    var days = state.nutrition.days.map(function (day, di) {
      var meals = day.meals.map(function (meal, mi) {
        return (
          '<article class="meal-card">' +
            "<h3>" + MEAL_LABELS[meal.meal] + ": " + escapeHtml(meal.name) + "</h3>" +
            "<p>" + escapeHtml(meal.ingredients.map(function (i) { return i.name + " — " + i.amount; }).join("; ")) + "</p>" +
            "<p>Порция: " + escapeHtml(meal.portion) + (state.program.safety.medicalNutritionCaution ? "." : ". Ориентир: " + meal.kcal + " ккал, Б " + meal.protein + " / Ж " + meal.fat + " / У " + meal.carbs + ".") + "</p>" +
            "<p>Как приготовить: " + escapeHtml(meal.method) + "</p>" +
            "<p>Замены: " + escapeHtml(meal.swaps.join(", ")) + "</p>" +
            '<button class="btn btn-small" type="button" data-action="replace-meal" data-day="' + di + '" data-meal="' + mi + '">Заменить блюдо</button>' +
          "</article>"
        );
      }).join("");
      return '<section class="day-block"><h2>' + day.title + "</h2>" + meals + "</section>";
    }).join("");
    var shopping = collectShopping();
    var groups = {};
    shopping.forEach(function (item) {
      groups[item.category] = groups[item.category] || [];
      groups[item.category].push(item);
    });
    var shopHtml = Object.keys(APP_DATA.shoppingCategories).map(function (cat) {
      if (!groups[cat]) return "";
      return "<h3>" + APP_DATA.shoppingCategories[cat] + "</h3><ul class='check-list'>" + groups[cat].map(function (item) {
        return '<li><label><input type="checkbox" data-action="shop-item" data-id="' + escapeHtml(item.id) + '"' + (item.checked ? " checked" : "") + "> " + escapeHtml(item.name) + " <span class='muted'>" + escapeHtml(item.amount) + "</span></label></li>";
      }).join("") + "</ul>";
    }).join("");
    var pattern = state.nutrition.pattern;
    root.innerHTML =
      (state.isDemo ? '<p class="demo-tag">Пример меню</p>' : "") +
      " <h1>Питание</h1>" +
      '<p class="lead">Гибкий конструктор на семь дней. Нет обязательных запрещённых продуктов: любимую еду можно оставить в разумной порции.</p>' +
      caution +
      '<div class="segmented" role="group" aria-label="Количество приёмов пищи">' +
        seg("3", "3 приёма", pattern) +
        seg("4", "3 приёма и перекус", pattern) +
        seg("5", "3 приёма и 2 перекуса", pattern) +
      "</div>" +
      '<div class="toolbar"><button class="btn" type="button" data-action="print-menu">Распечатать меню</button>' +
      '<button class="btn btn-ghost" type="button" data-action="copy-shop">Скопировать список покупок</button></div>' +
      '<div id="print-area">' + days + "</div>" +
      '<section class="panel"><h2>Список покупок на неделю</h2>' + shopHtml + "</section>";
  }

  function seg(value, label, current) {
    var on = String(current) === value || (current === "3+1" && value === "4") || (current === "3+2" && value === "5");
    return '<button type="button" class="' + (on ? "is-on" : "") + '" data-action="meal-pattern" data-pattern="' + value + '">' + label + "</button>";
  }

  function renderWorkouts() {
    var root = $("#view-workouts");
    if (!state.training) {
      root.innerHTML = hasProgram()
        ? "<h1>Тренировки</h1><p>План тренировок не составлен. Используйте только активность, которую разрешил врач.</p>"
        : emptyBlock("План тренировок появится после анкеты.", "Составить программу", "quiz");
      return;
    }
    var flags = consecutiveTrainingFlags();
    var warn = "";
    if (flags.hard >= 3 || flags.pain >= 2) {
      warn = '<div class="notice notice-yellow">Несколько тренировок подряд дались слишком тяжело или появилась боль. Снизьте объём. Если симптомы сохраняются, обратитесь к специалисту.</div>';
      state.reduceTraining = true;
      saveState();
    }
    var sessions = state.training.sessions.map(function (s) {
      var log = state.training.log[s.date] || {};
      return (
        '<article class="session-card">' +
          "<h3>" + formatDateRu(s.date) + " · неделя " + s.week + " · " + escapeHtml(s.title) + "</h3>" +
          "<p>Уровень: " + s.level + ". Длительность около " + s.duration + " мин. Субъективная нагрузка " + s.rpe + " из 10. " + s.setsHint + ".</p>" +
          "<p><strong>Разминка.</strong> " + s.warmup.map(function (e) { return e.name + " (" + e.time + ")"; }).join("; ") + "</p>" +
          "<p><strong>Основная часть.</strong></p><ul class='plain'>" + s.main.map(function (e) {
            return "<li>" + escapeHtml(e.name) + " — " + (e.sets || "") + " × " + (e.reps || e.time || "") + ", отдых " + (e.rest || "по самочувствию") + ". Облегчённый вариант: " + escapeHtml(e.easier) + ".</li>";
          }).join("") + "</ul>" +
          "<p><strong>Заминка.</strong> " + s.cooldown.map(function (e) { return e.name; }).join("; ") + "</p>" +
          "<p class='muted'>" + s.note + "</p>" +
          '<div class="status-row">' +
            statusBtn(s.date, "done", "Выполнено", log.status) +
            statusBtn(s.date, "partial", "Частично", log.status) +
            statusBtn(s.date, "skipped", "Пропущено", log.status) +
            statusBtn(s.date, "moved", "Перенесено", log.status) +
          "</div>" +
          (log.status ? "<p class='muted'>Отметка: сложность " + (log.rpe || "—") + "/10, самочувствие " + (log.feeling || "—") + ", боль: " + (log.pain === "yes" ? "да" : "нет") + (log.comment ? ". " + escapeHtml(log.comment) : "") + "</p>" : "") +
        "</article>"
      );
    }).join("");
    root.innerHTML =
      (state.isDemo ? '<p class="demo-tag">Пример плана</p>' : "") +
      "<h1>Тренировки</h1>" +
      '<p class="lead">План на 4 недели, уровень «' + state.training.levelLabel + '». Не обязательно сразу выходить на 150 минут активности в неделю — объём растёт постепенно.</p>' +
      warn + sessions;
  }

  function statusBtn(date, status, label, current) {
    return '<button type="button" class="btn btn-small' + (current === status ? " is-on" : "") + '" data-action="train-status" data-date="' + date + '" data-status="' + status + '">' + label + "</button>";
  }

  function renderHabits() {
    var root = $("#view-habits");
    if (!hasProgram()) {
      root.innerHTML = emptyBlock("Трекер привычек откроется после анкеты.", "Составить программу", "quiz");
      return;
    }
    ensureHabitWeek();
    var start = state.habits.weekStart;
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(start, i));
    var table = "<div class='habit-table-wrap'><table class='habit-table'><thead><tr><th>Привычка</th>" + days.map(function (d, i) { return "<th>" + DAY_NAMES[i] + "<br><span class='muted'>" + d.slice(8) + "</span></th>"; }).join("") + "</tr></thead><tbody>" +
      APP_DATA.habits.map(function (h) {
        return "<tr><th scope='row'><span>" + h.title + "</span><small>" + h.hint + "</small></th>" + days.map(function (d) {
          var on = state.habits.checks[h.id] && state.habits.checks[h.id][d];
          return '<td><button type="button" class="habit-dot' + (on ? " is-on" : "") + '" data-action="habit" data-id="' + h.id + '" data-date="' + d + '" aria-label="' + h.title + ", " + formatDateRu(d) + '" aria-pressed="' + (on ? "true" : "false") + '"></button></td>';
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
    root.innerHTML =
      "<h1>Привычки и повседневная активность</h1>" +
      '<p class="lead">Следующая цель по шагам: ' + (state.program.stepsGoal || "—") + " в день — это около 5–10% выше вашего исходного среднего, если нет ограничений.</p>" +
      '<div class="notice">Норму воды по массе тела приложение не назначает. Ориентируйтесь на жажду, погоду, активность и рекомендации врача, особенно при заболеваниях сердца и почек.</div>' +
      table;
  }

  function renderProgress() {
    var root = $("#view-progress");
    var canEdit = hasProgram();
    var entries = (state.diary || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var last7 = entries.filter(function (e) { return e.date >= addDays(isoDate(new Date()), -6); });
    var weights = last7.map(function (e) { return Number(e.weight); }).filter(Boolean);
    var avg = weights.length ? (weights.reduce(function (a, b) { return a + b; }, 0) / weights.length).toFixed(1) : "—";
    var startW = state.profile ? state.profile.weightKg : null;
    var lastW = weights.length ? weights[weights.length - 1] : null;
    var delta = startW && lastW ? (lastW - startW).toFixed(1) : "—";
    var list = entries.length
      ? "<ul class='diary-list'>" + entries.slice().reverse().map(function (e) {
        return "<li><strong>" + formatDateRu(e.date) + "</strong> · вес " + (e.weight || "—") + " кг · талия " + (e.waist || "—") + " см · шаги " + (e.steps || "—") + "<br><span class='muted'>Сон " + (e.sleep || "—") + " ч, энергия " + (e.energy || "—") + ", настроение " + (e.mood || "—") + ". " + escapeHtml(e.notes || "") + "</span></li>";
      }).join("") + "</ul>"
      : '<div class="empty"><p>Записей пока нет. Добавьте первое взвешивание или заметку о самочувствии. По одному дню выводы не делаются: вес может меняться из-за воды, соли, пищеварения и цикла.</p></div>';
    root.innerHTML =
      "<h1>Прогресс</h1>" +
      '<p class="lead">Не делайте вывод по одному взвешиванию. Смотрите среднее за семь дней и самочувствие.</p>' +
      '<div class="cards">' +
        card("Среднее за 7 дней", avg === "—" ? "нет данных" : avg + " кг", "Нужно несколько записей.") +
        card("Изменение от старта", delta === "—" ? "нет данных" : delta + " кг", "Колебания по дням — обычное дело.") +
        card("Тренировки", countWorkouts() + " отметок", "Выполнено и частично за всё время плана.") +
      "</div>" +
      '<div class="charts"><div class="panel"><h2>Вес</h2><canvas id="chart-weight" width="640" height="220" aria-label="График веса"></canvas><p class="empty-chart" ' + (entries.length ? "hidden" : "") + ">График появится после записей.</p></div>" +
      '<div class="panel"><h2>Обхват талии</h2><canvas id="chart-waist" width="640" height="220" aria-label="График талии"></canvas></div></div>' +
      (canEdit ? '<form id="diary-form" class="panel form-grid">' +
        "<h2>Новая запись</h2>" +
        '<label>Дата<input type="date" name="date" required></label>' +
        '<label>Вес, кг<input type="number" name="weight" min="20" max="300" step="0.1"></label>' +
        '<label>Талия, см<input type="number" name="waist" min="40" max="200" step="0.5"></label>' +
        '<label>Шаги<input type="number" name="steps" min="0" max="100000"></label>' +
        '<label>Тренировка<select name="workout"><option value="">Не отмечали</option><option value="yes">Да</option><option value="partial">Частично</option><option value="no">Нет</option></select></label>' +
        '<label>Питание<select name="meals"><option value="">Без оценки</option><option value="yes">Близко к плану</option><option value="mostly">В целом да</option><option value="no">Сильно отличалось</option></select></label>' +
        '<label>Сон, ч<input type="number" name="sleep" min="0" max="16" step="0.5"></label>' +
        '<label>Энергия<select name="energy"><option value="ok">Обычная</option><option value="medium">Средняя</option><option value="low">Низкая</option></select></label>' +
        '<label>Настроение<select name="mood"><option value="ok">Ровное</option><option value="low">Снижено</option><option value="high">Приподнятое</option></select></label>' +
        '<label>Голод<select name="hunger"><option value="medium">Умеренный</option><option value="low">Слабый</option><option value="high">Сильный</option></select></label>' +
        '<label class="full">Заметки<textarea name="notes" rows="2" maxlength="400"></textarea></label>' +
        '<button class="btn full" type="submit">Сохранить запись</button>' +
      "</form>" : "") +
      list;
    requestAnimationFrame(function () {
      drawChart($("#chart-weight"), entries.map(function (e) { return { x: e.date, y: Number(e.weight) }; }).filter(function (p) { return p.y; }), "#161816");
      drawChart($("#chart-waist"), entries.map(function (e) { return { x: e.date, y: Number(e.waist) }; }).filter(function (p) { return p.y; }), "#C8E600");
      var form = $("#diary-form");
      if (form) form.date.value = isoDate(new Date());
    });
  }

  function countWorkouts() {
    if (!state.training) return 0;
    return Object.keys(state.training.log).filter(function (k) {
      var s = state.training.log[k].status;
      return s === "done" || s === "partial";
    }).length;
  }

  function drawChart(canvas, points, color) {
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!points.length) {
      ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue("--color-text-secondary") || "#646861").trim();
      ctx.font = "500 16px Rubik, Arial, sans-serif";
      ctx.fillText("Недостаточно данных для графика", 24, h / 2);
      return;
    }
    var pad = 36;
    var ys = points.map(function (p) { return p.y; });
    var min = Math.min.apply(null, ys) - 1;
    var max = Math.max.apply(null, ys) + 1;
    ctx.strokeStyle = (getComputedStyle(document.documentElement).getPropertyValue("--color-border") || "#D9DDD7").trim();
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.lineTo(w - 12, h - pad);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad - 16);
      var y = pad + (1 - (p.y - min) / (max - min || 1)) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = color;
    points.forEach(function (p, i) {
      var x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad - 16);
      var y = pad + (1 - (p.y - min) / (max - min || 1)) * (h - pad * 2);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderMaterials() {
    $("#view-materials").innerHTML = "<h1>Полезные материалы</h1><p class='lead'>Короткие тексты про питание, движение и повседневные привычки.</p>" + APP_DATA.articles.map(function (a) {
      return '<article class="panel"><h2>' + a.title + "</h2><p>" + a.body + "</p></article>";
    }).join("");
  }

  function renderSettings() {
    var root = $("#view-settings");
    root.innerHTML =
      "<h1>Настройки</h1>" +
      '<p class="lead">Данные хранятся только в браузере на этом устройстве.</p>' +
      '<div class="settings-actions">' +
        (state.isDemo ? '<button class="btn" type="button" data-action="clear-demo">Очистить пример и заполнить анкету</button>' : "") +
        '<button class="btn" type="button" data-action="demo">Посмотреть пример</button>' +
        '<button class="btn btn-danger" type="button" data-action="delete-data">Удалить все мои данные</button>' +
      "</div>" +
      "<p class='muted'>Ключ хранилища: <code>" + STORAGE_KEY + "</code>. Сохраняются анкета, расчёты, меню, отметки тренировок, привычки, дневник и тема оформления.</p>";
  }

  /* ---------- события ---------- */

  function bindEvents() {
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeModal();
        moreOpen = false;
        var sheet = $("#more-sheet");
        if (sheet) sheet.hidden = true;
      }
    });
    $("#modal").addEventListener("click", function (e) {
      if (e.target.id === "modal") closeModal();
    });
  }

  function onClick(e) {
    var viewLink = e.target.closest("[data-view-link]");
    if (viewLink) {
      e.preventDefault();
      showView(viewLink.getAttribute("data-view-link"));
      return;
    }
    var nav = e.target.closest("[data-nav]");
    if (nav) {
      e.preventDefault();
      var target = nav.getAttribute("data-nav");
      if (target === "more") {
        moreOpen = !moreOpen;
        $("#more-sheet").hidden = !moreOpen;
        nav.setAttribute("aria-expanded", moreOpen ? "true" : "false");
        return;
      }
      showView(target);
      return;
    }
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    if (action === "quiz-next") {
      var form = $("#quiz-form");
      if (validateQuizStep(form, quizStep)) setQuizStep(quizStep + 1);
    } else if (action === "quiz-prev") {
      setQuizStep(Math.max(1, quizStep - 1));
    } else if (action === "demo") {
      var built = buildProgram(demoProfile(), true);
      applyBuiltProgram(built, true);
    } else if (action === "clear-demo") {
      clearAllData();
      showView("quiz");
      setQuizStep(1, { animate: false });
    } else if (action === "delete-data") {
      openModal('<h2>Удалить данные?</h2><p>Анкета, программа, дневник и отметки будут стёрты с этого устройства. Восстановить их будет нельзя.</p><div class="btn-row"><button class="btn btn-danger" type="button" data-action="delete-confirm">Удалить</button><button class="btn btn-ghost" type="button" data-action="close-modal">Отмена</button></div>');
    } else if (action === "delete-confirm") {
      closeModal();
      clearAllData();
    } else if (action === "close-modal") {
      closeModal();
    } else if (action === "theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      saveState();
      applyTheme();
    } else if (action === "replace-meal") {
      replaceMeal(Number(btn.getAttribute("data-day")), Number(btn.getAttribute("data-meal")));
    } else if (action === "meal-pattern") {
      if (!state.profile || !state.program) return;
      state.nutrition = buildMealPlan(state.profile, state.program, btn.getAttribute("data-pattern"));
      saveState();
      renderNutrition();
      toast("Меню обновлено.");
    } else if (action === "copy-shop") {
      var text = collectShopping().map(function (i) { return "• " + i.name + " (" + i.amount + ")"; }).join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast("Список покупок скопирован."); }).catch(function () { toast("Не удалось скопировать автоматически."); });
      } else {
        toast("Скопируйте список вручную.");
      }
    } else if (action === "print-menu") {
      window.print();
    } else if (action === "train-status") {
      openTrainingLog(btn.getAttribute("data-date"), btn.getAttribute("data-status"));
    } else if (action === "habit") {
      var hid = btn.getAttribute("data-id");
      var date = btn.getAttribute("data-date");
      state.habits.checks[hid] = state.habits.checks[hid] || {};
      state.habits.checks[hid][date] = !state.habits.checks[hid][date];
      saveState();
      var on = !!state.habits.checks[hid][date];
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.remove("is-pulse");
      void btn.offsetWidth;
      btn.classList.add("is-pulse");
    } else if (action === "confirm-adjust") {
      var type = btn.getAttribute("data-type");
      if (type === "ease" && state.nutrition && state.program.calories && !state.program.calories.blocked) {
        state.program.calories.min = Math.round(state.program.calories.min * 1.05);
        state.program.calories.max = Math.round(state.program.calories.max * 1.05);
        state.nutrition = buildMealPlan(state.profile, state.program, state.nutrition.pattern);
        state.reduceTraining = true;
        saveState();
        toast("Калорийность слегка увеличена, нагрузку лучше снизить. Калорийность вниз автоматически не меняется.");
        renderProgram();
      } else {
        toast("Калорийность автоматически не уменьшается. Проверьте записи, сон и шаги.");
      }
    } else if (action === "save-train-log") {
      var form = $("#train-log-form");
      var date = form.getAttribute("data-date");
      state.training.log[date] = {
        status: form.getAttribute("data-status"),
        rpe: form.rpe.value,
        feeling: form.feeling.value,
        pain: form.pain.value,
        comment: form.comment.value
      };
      saveState();
      closeModal();
      renderWorkouts();
      toast("Отметка о тренировке сохранена.");
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t.getAttribute("data-action") === "shop-item") {
      state.nutrition.shoppingChecked = state.nutrition.shoppingChecked || {};
      state.nutrition.shoppingChecked[t.getAttribute("data-id")] = t.checked;
      saveState();
    }
  }

  function onSubmit(e) {
    if (e.target.id === "quiz-form") {
      e.preventDefault();
      if (!validateQuizStep(e.target, 5)) return;
      var profile = gatherQuiz(e.target);
      var built = buildProgram(profile, false);
      applyBuiltProgram(built, false);
      return;
    }
    if (e.target.id === "diary-form") {
      e.preventDefault();
      var f = e.target;
      var entry = {
        date: f.date.value,
        weight: f.weight.value ? Number(f.weight.value) : "",
        waist: f.waist.value ? Number(f.waist.value) : "",
        steps: f.steps.value ? Number(f.steps.value) : "",
        workout: f.workout.value,
        meals: f.meals.value,
        sleep: f.sleep.value ? Number(f.sleep.value) : "",
        energy: f.energy.value,
        mood: f.mood.value,
        hunger: f.hunger.value,
        notes: f.notes.value
      };
      if (entry.weight !== "" && entry.weight <= 0) {
        toast("Вес должен быть больше нуля.");
        return;
      }
      state.diary = state.diary.filter(function (x) { return x.date !== entry.date; });
      state.diary.push(entry);
      saveState();
      renderProgress();
      toast("Запись дневника сохранена.");
    }
  }

  function openTrainingLog(date, status) {
    openModal(
      "<h2>Как прошла тренировка " + formatDateRu(date) + "</h2>" +
      '<form id="train-log-form" data-date="' + date + '" data-status="' + status + '">' +
        '<label>Субъективная сложность, 1–10<input type="number" name="rpe" min="1" max="10" value="5" required></label>' +
        '<label>Самочувствие<select name="feeling"><option value="ok">Обычное</option><option value="tired">Усталость</option><option value="good">Хорошее</option></select></label>' +
        '<label>Боль<select name="pain"><option value="no">Нет</option><option value="yes">Да</option></select></label>' +
        '<label>Комментарий<textarea name="comment" rows="2"></textarea></label>' +
        '<button class="btn" type="button" data-action="save-train-log">Сохранить</button>' +
      "</form>"
    );
  }

  /* ---------- тесты расчётов в консоли ---------- */

  function selfCheck() {
    var bmi = calcBMI(89, 176);
    if (Math.abs(bmi - 28.73) > 0.1) console.error("Ошибка ИМТ", bmi);
    var bmrM = calcBMR(89, 176, 38, "male");
    if (Math.abs(bmrM - (10 * 89 + 6.25 * 176 - 5 * 38 + 5)) > 0.01) console.error("Ошибка BMR");
    var bmrF = calcBMR(70, 165, 30, "female");
    if (Math.abs(bmrF - (10 * 70 + 6.25 * 165 - 5 * 30 - 161)) > 0.01) console.error("Ошибка BMR жен");
    var under = assessSafety(Object.assign(demoProfile(), { weightKg: 50, heightCm: 176 }));
    if (under.level !== "red") console.error("ИМТ < 18.5 должен давать красный уровень");
    var preg = assessSafety(Object.assign(demoProfile(), { pregnancy: "yes", sex: "female" }));
    if (preg.level !== "red" || !preg.blocksDeficit) console.error("Беременность должна блокировать дефицит");
    var kid = assessSafety(Object.assign(demoProfile(), { age: 16 }));
    if (!kid.underage) console.error("Возраст < 18 должен блокировать программу");
    var ed = assessSafety(Object.assign(demoProfile(), { eatingDisorder: "yes" }));
    if (ed.level !== "red" || !ed.blocksDeficit) console.error("Расстройство пищевого поведения должно давать красный уровень");
    var acute = assessSafety(Object.assign(demoProfile(), { acuteSymptoms: "yes" }));
    if (!acute.emergency) console.error("Острые симптомы должны показывать обращение за помощью");
    var yellow = assessSafety(Object.assign(demoProfile(), { diabetes: "yes", age: 68 }));
    if (yellow.level !== "yellow" || yellow.blocksDeficit) console.error("Диабет и возраст 65+ — жёлтый уровень без запрета на ориентир");
    var cal = calcCalorieRange(1126.8, "female", true);
    if (!cal.blocked || !cal.consult) console.error("Калорийность ниже защитного порога не должна показываться");
    var okCal = calcCalorieRange(2481, "male", true);
    if (okCal.min < 1500 || okCal.max < okCal.min) console.error("Ошибка диапазона калорий");
  }

  /* ---------- запуск ---------- */

  function init() {
    state = loadState();
    applyTheme();
    renderHealthFields();
    bindEvents();
    setQuizStep(1);
    refreshChrome();
    selfCheck();
    var hash = (location.hash || "").replace("#", "");
    if (hash && document.querySelector('[data-view="' + hash + '"]')) {
      showView(hash);
    } else if (hasProgram()) {
      if (state.program.safety.level === "red" || state.program.safety.underage) showView("limited");
      else showView("home");
    } else {
      showView("home");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
