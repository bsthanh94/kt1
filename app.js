// ========== BIẾN TOÀN CỤC ==========
let rawData = [];
let headers = [];
let currentMapping = {};
let isSettingsOpen = false;

// Cấu hình trình tự
let sequenceConfig = [];
let evolutionConfig = [];
let durationConfig = [];
// Cấu hình thời gian gối
let thresholdConfig = [];
// Cấu hình máy cho phép theo thủ thuật
let machineMappingConfig = [];
// Cấu hình công suất máy (mới)
let machineCapacityConfig = [];

const FIELDS = [
    { id: "stt", label: "STT", defaultIdx: 0 },
    { id: "maKCB", label: "Mã KCB", defaultIdx: 1 },
    { id: "hoTen", label: "Họ tên", defaultIdx: 2 },
    { id: "tuoi", label: "Tuổi", defaultIdx: 3 },
    { id: "diaChi", label: "Địa chỉ", defaultIdx: 5 },
    { id: "phuongPhap", label: "Phương pháp thủ thuật", defaultIdx: 10 },
    { id: "trinhTu", label: "Trình tự", defaultIdx: 11 },
    { id: "chanDoan", label: "Chẩn đoán", defaultIdx: 8 },
    { id: "dienBien", label: "Diễn biến", defaultIdx: 12 },
    { id: "startTime", label: "Ngày giờ bắt đầu", defaultIdx: 14 },
    { id: "endTime", label: "Ngày giờ kết thúc", defaultIdx: 15 },
    { id: "doctor", label: "Bác sỹ thủ thuật", defaultIdx: 18 },
    { id: "assistantDoctor", label: "Bác sĩ phụ", defaultIdx: 19 },
    { id: "machine", label: "Máy TH", defaultIdx: 20 }
];

const COLOR_PALETTE = [
    "#FFE2E2", "#E0F7E8", "#FFE6CC", "#D9E6FF", "#F9E0F0", "#D4F1F9", "#FFF0C0", "#E2E0FF", "#C9E9DC", "#FFD9B5"
];

// ========== HELPER ==========
function parseDateTime(dateTimeStr) {
    if (!dateTimeStr || typeof dateTimeStr !== 'string') return null;
    let trimmed = dateTimeStr.trim();
    const regex = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = trimmed.match(regex);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    let minute = parseInt(match[2], 10);
    let day = parseInt(match[3], 10);
    let month = parseInt(match[4], 10) - 1;
    let year = parseInt(match[5], 10);
    return new Date(year, month, day, hour, minute);
}

function getProcedureThreshold(procName) {
    if (!procName) return null;
    const name = procName.toLowerCase();
    for (let rule of thresholdConfig) {
        if (name.includes(rule.keyword.toLowerCase())) {
            return rule.minutes;
        }
    }
    return null;
}

function getMachineCapacity(machineName) {
    if (!machineName) return 1; // mặc định công suất 1
    const machineLower = machineName.toLowerCase();
    for (let rule of machineCapacityConfig) {
        if (machineLower.includes(rule.keyword.toLowerCase())) {
            return rule.capacity;
        }
    }
    return 1; // mặc định
}

function isMachineAllowed(procName, machineName) {
    if (!procName || !machineName) return true;
    const procLower = procName.toLowerCase();
    const machineLower = machineName.toLowerCase();
    for (let rule of machineMappingConfig) {
        if (procLower.includes(rule.keyword.toLowerCase())) {
            if (!rule.machines || rule.machines.trim() === "") return true;
            const allowedMachines = rule.machines.split(',').map(m => m.trim().toLowerCase());
            for (let allowed of allowedMachines) {
                if (allowed !== "" && machineLower.includes(allowed)) {
                    return true;
                }
            }
            return false;
        }
    }
    return true;
}

function truncateText(text, maxWords = 4, maxChars = 60) {
    if (!text) return "";
    let words = text.split(/\s+/);
    if (words.length > maxWords) {
        return words.slice(0, maxWords).join(" ") + "...";
    }
    if (text.length > maxChars) {
        return text.slice(0, maxChars) + "...";
    }
    return text;
}

// ========== XUNG ĐỘT BÁC SĨ (giữ nguyên) ==========
function getConflictDetail(ca1, ca2, thresholdMinutes) {
    const start1 = ca1.startDate.getTime();
    const end1 = ca1.endDate.getTime();
    const start2 = ca2.startDate.getTime();
    const end2 = ca2.endDate.getTime();

    if (end1 <= start2) {
        const gapMinutes = (start2 - end1) / (1000 * 60);
        if (gapMinutes < thresholdMinutes) {
            return `⚠️ Khoảng cách gối quá ngắn (${Math.round(gapMinutes)} phút, yêu cầu tối thiểu ${thresholdMinutes} phút)`;
        }
        return null;
    }
    if (end2 <= start1) {
        const gapMinutes = (start1 - end2) / (1000 * 60);
        if (gapMinutes < thresholdMinutes) {
            return `⚠️ Khoảng cách gối quá ngắn (${Math.round(gapMinutes)} phút, yêu cầu tối thiểu ${thresholdMinutes} phút)`;
        }
        return null;
    }
    if (end1 === start2 || end2 === start1) {
        return "❌ Trùng đầu cuối (end = start) - Không được phép";
    }
    return "❌ Trùng thời gian giao nhau";
}

function checkDoctorConflict(ca1, ca2) {
    if (ca1.endDate.getTime() === ca2.startDate.getTime() ||
        ca2.endDate.getTime() === ca1.startDate.getTime()) {
        return { isConflict: true, detail: "❌ Trùng đầu cuối (end = start) - Không được phép" };
    }
    const th1 = ca1.threshold, th2 = ca2.threshold;
    const maxThreshold = Math.max(th1 || 0, th2 || 0);
    if (maxThreshold === 0) {
        if (ca1.endDate > ca2.startDate && ca2.endDate > ca1.startDate) {
            return { isConflict: true, detail: "❌ Trùng thời gian giao nhau" };
        }
        return { isConflict: false, detail: null };
    }
    const gapMs = Math.abs(ca1.startDate - ca2.startDate);
    const gapMinutes = gapMs / (1000 * 60);
    if (gapMinutes < maxThreshold) {
        if (ca1.endDate > ca2.startDate && ca2.endDate > ca1.startDate) {
            return { isConflict: true, detail: `❌ Trùng thời gian giao nhau (khoảng cách ${Math.round(gapMinutes)} phút < ${maxThreshold} phút)` };
        } else if (ca1.endDate <= ca2.startDate || ca2.endDate <= ca1.startDate) {
            const gap = Math.abs((ca1.endDate - ca2.startDate) / (1000 * 60));
            return { isConflict: true, detail: `⚠️ Khoảng cách gối quá ngắn (${Math.round(gap)} phút, yêu cầu tối thiểu ${maxThreshold} phút)` };
        } else {
            return { isConflict: true, detail: `⚠️ Khoảng cách quá ngắn (${Math.round(gapMinutes)} phút < ${maxThreshold} phút)` };
        }
    }
    return { isConflict: false, detail: null };
}

function findDoctorConflictGroupsWithDetails(items) {
    const n = items.length;
    const parent = Array(n).fill().map((_, i) => i);
    const rank = Array(n).fill(0);
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(x, y) { let rx = find(x), ry = find(y); if (rx !== ry) { if (rank[rx] < rank[ry]) parent[rx] = ry; else if (rank[rx] > rank[ry]) parent[ry] = rx; else { parent[ry] = rx; rank[rx]++; } } }
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (checkDoctorConflict(items[i], items[j]).isConflict) union(i, j);
        }
    }
    const groupMap = new Map();
    for (let i = 0; i < n; i++) {
        let root = find(i);
        if (!groupMap.has(root)) groupMap.set(root, []);
        groupMap.get(root).push(i);
    }
    return [...groupMap.values()].filter(g => g.length >= 2);
}

// ========== XUNG ĐỘT MÁY (mới: có công suất và ngưỡng gối) ==========

// Hàm kiểm tra khoảng cách gối giữa hai ca (không quan tâm giao nhau)
function checkMachineGap(ca1, ca2, thresholdMinutes) {
    const start1 = ca1.startDate.getTime();
    const end1 = ca1.endDate.getTime();
    const start2 = ca2.startDate.getTime();
    const end2 = ca2.endDate.getTime();

    // Xác định ca trước và ca sau
    let earlier, later;
    if (end1 <= start2) {
        earlier = ca1;
        later = ca2;
    } else if (end2 <= start1) {
        earlier = ca2;
        later = ca1;
    } else {
        // Hai ca giao nhau -> không cần kiểm tra khoảng cách gối (sẽ xử lý ở phần công suất)
        return null;
    }

    const gapMinutes = (later.startDate - earlier.endDate) / (1000 * 60);
    if (gapMinutes < thresholdMinutes) {
        return `⚠️ Khoảng cách gối quá ngắn (${Math.round(gapMinutes)} phút, yêu cầu tối thiểu ${thresholdMinutes} phút)`;
    }
    return null;
}

function getMachineConflictRecordsWithDetails() {
    if (!rawData.length) return [];
    const result = [];

    // Gom ca theo máy
    const groupsMap = new Map();
    for (let idx = 0; idx < rawData.length; idx++) {
        const item = rawData[idx];
        const machine = item.machine;
        if (!machine || machine === '' || machine === ' ') continue;
        if (!groupsMap.has(machine)) groupsMap.set(machine, []);
        groupsMap.get(machine).push({ ...item, originalIndex: idx });
    }

    // Duyệt từng máy
    for (let [machineName, items] of groupsMap.entries()) {
        if (items.length < 2) continue;
        const capacity = getMachineCapacity(machineName);

        // Sắp xếp theo thời gian bắt đầu
        const sorted = items.slice().sort((a, b) => a.startDate - b.startDate);

        // --- Bước 1: Tìm các nhóm ca giao nhau (union find) ---
        const n = sorted.length;
        const parent = Array(n).fill().map((_, i) => i);
        const rank = Array(n).fill(0);
        function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
        function union(x, y) { let rx = find(x), ry = find(y); if (rx !== ry) { if (rank[rx] < rank[ry]) parent[rx] = ry; else if (rank[rx] > rank[ry]) parent[ry] = rx; else { parent[ry] = rx; rank[rx]++; } } }
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = sorted[i];
                const b = sorted[j];
                // Hai ca giao nhau nếu start < end của nhau
                if (a.startDate < b.endDate && b.startDate < a.endDate) {
                    union(i, j);
                }
            }
        }
        // Gom nhóm
        const groupMap = new Map();
        for (let i = 0; i < n; i++) {
            const root = find(i);
            if (!groupMap.has(root)) groupMap.set(root, []);
            groupMap.get(root).push(i);
        }
        // Chỉ lấy nhóm có từ 2 ca trở lên
        const overlapGroups = [...groupMap.values()].filter(indices => indices.length >= 2);

        if (overlapGroups.length === 0) continue;

        // --- Bước 2: Xử lý từng nhóm ---
        let colorIdx = 0;
        for (let indices of overlapGroups) {
            const groupItems = indices.map(i => sorted[i]);
            // Kiểm tra vượt công suất trong nhóm
            let maxConcurrent = 0;
            for (let i = 0; i < groupItems.length; i++) {
                let concurrent = 0;
                for (let j = 0; j < groupItems.length; j++) {
                    if (groupItems[j].startDate < groupItems[i].endDate && groupItems[i].startDate < groupItems[j].endDate) {
                        concurrent++;
                    }
                }
                if (concurrent > maxConcurrent) maxConcurrent = concurrent;
            }
            const isOverCapacity = maxConcurrent > capacity;

            // Kiểm tra khoảng cách gối giữa các ca trong nhóm (chỉ các cặp không giao nhau)
            const gapErrors = [];
            for (let i = 0; i < groupItems.length; i++) {
                for (let j = i + 1; j < groupItems.length; j++) {
                    const ca1 = groupItems[i];
                    const ca2 = groupItems[j];
                    const th1 = getProcedureThreshold(ca1.phuongPhap) || 0;
                    const th2 = getProcedureThreshold(ca2.phuongPhap) || 0;
                    const threshold = Math.max(th1, th2);
                    if (threshold === 0) continue;
                    const gapError = checkMachineGap(ca1, ca2, threshold);
                    if (gapError) {
                        gapErrors.push({ ca1, ca2, error: gapError });
                    }
                }
            }

            // Nếu không có lỗi gì (không vượt công suất và không có gap error) -> bỏ qua nhóm này
            if (!isOverCapacity && gapErrors.length === 0) continue;

            // Ngược lại: tô màu cho tất cả ca trong nhóm và gắn lỗi
            const groupColor = COLOR_PALETTE[colorIdx % COLOR_PALETTE.length];
            colorIdx++;

            // Tạo map lỗi cho từng ca trong nhóm
            const errorMap = new Map();
            if (isOverCapacity) {
                const capError = `⚠️ Vượt công suất máy (${capacity} ca tối đa, thực tế có ${maxConcurrent} ca chồng lấn)`;
                for (let item of groupItems) {
                    if (!errorMap.has(item.originalIndex)) errorMap.set(item.originalIndex, []);
                    errorMap.get(item.originalIndex).push(capError);
                }
            }
            for (let gap of gapErrors) {
                const errorMsg = `Với ca ${gap.ca2.stt || ''} (${gap.ca2.hoTen || ''}): ${gap.error}`;
                if (!errorMap.has(gap.ca1.originalIndex)) errorMap.set(gap.ca1.originalIndex, []);
                errorMap.get(gap.ca1.originalIndex).push(errorMsg);
                const errorMsg2 = `Với ca ${gap.ca1.stt || ''} (${gap.ca1.hoTen || ''}): ${gap.error}`;
                if (!errorMap.has(gap.ca2.originalIndex)) errorMap.set(gap.ca2.originalIndex, []);
                errorMap.get(gap.ca2.originalIndex).push(errorMsg2);
            }

            // Tạo record cho từng ca trong nhóm
            for (let item of groupItems) {
                const errors = errorMap.get(item.originalIndex) || [];
                if (errors.length === 0) continue;
                const uniqueErrors = [...new Set(errors)];
                const conflictDetail = uniqueErrors.join('; ');
                result.push({
                    ...item,
                    conflictGroupId: `${machineName}|${colorIdx}`,
                    groupColor: groupColor,
                    displayGroupKey: machineName,
                    conflictDetail: conflictDetail
                });
            }
        }
    }

    // Lọc chỉ những record có conflictDetail không rỗng
    return result.filter(r => r.conflictDetail && r.conflictDetail.trim() !== '');
}

// ========== XUNG ĐỘT BÁC SĨ (gọi hàm cũ) ==========
function getDoctorConflictRecordsWithDetails() {
    const groupsMap = new Map();
    for (let idx = 0; idx < rawData.length; idx++) {
        const item = rawData[idx];
        const doctor = item.doctor;
        if (!doctor || doctor === '' || doctor === ' ') continue;
        if (!groupsMap.has(doctor)) groupsMap.set(doctor, []);
        groupsMap.get(doctor).push({ ...item, originalIndex: idx });
    }
    let conflictRecords = [];
    for (let [doctorName, items] of groupsMap.entries()) {
        if (items.length < 2) continue;
        const localGroups = findDoctorConflictGroupsWithDetails(items);
        if (localGroups.length === 0) continue;
        let colorIdx = 0;
        for (let indices of localGroups) {
            const groupColor = COLOR_PALETTE[colorIdx % COLOR_PALETTE.length];
            colorIdx++;
            for (let localIdx of indices) {
                const record = items[localIdx];
                let conflictDetails = [];
                for (let otherLocalIdx of indices) {
                    if (otherLocalIdx === localIdx) continue;
                    const other = items[otherLocalIdx];
                    const result = checkDoctorConflict(record, other);
                    if (result.isConflict) {
                        conflictDetails.push(`Với ca ${other.stt || ''} (${other.hoTen || ''}): ${result.detail}`);
                    }
                }
                const uniqueDetails = [...new Set(conflictDetails)];
                const errorString = uniqueDetails.join('; ');
                conflictRecords.push({
                    ...record,
                    conflictGroupId: `${doctorName}|${colorIdx}|${indices[0]}`,
                    groupColor,
                    displayGroupKey: doctorName,
                    conflictDetail: errorString || 'Xung đột lịch bác sĩ'
                });
            }
        }
    }
    return conflictRecords;
}

// ========== VALIDATION ==========
function validateSequence(record) {
    const procedure = record.phuongPhap || "";
    const sequence = record.trinhTu || "";
    if (!procedure || !sequence) return true;
    const config = sequenceConfig.find(c => procedure.toLowerCase().includes(c.name.toLowerCase()));
    if (!config) return true;
    const keywords = config.keywords.split(',').map(k => k.trim().toLowerCase());
    const seqLower = sequence.toLowerCase();
    return keywords.some(kw => seqLower.includes(kw));
}

function validateDiagnosisEvolution(record) {
    const diagnosis = record.chanDoan || "";
    const evolution = record.dienBien || "";
    if (!diagnosis || !evolution) return true;
    const diseases = diagnosis.split(';').map(d => d.trim());
    for (let diseaseStr of diseases) {
        const config = evolutionConfig.find(c => diseaseStr.toLowerCase().includes(c.disease.toLowerCase()));
        if (!config) continue;
        const keywords = config.keywords.split(',').map(k => k.trim().toLowerCase());
        const evoLower = evolution.toLowerCase();
        if (keywords.some(kw => evoLower.includes(kw))) return true;
    }
    return false;
}

function validateAssistant(record) {
    const procedure = record.phuongPhap || "";
    const assistant = record.assistantDoctor || "";
    if (!procedure) return true;
    const isElectroacupuncture = procedure.toLowerCase().includes("điện châm");
    const isMassage = procedure.toLowerCase().includes("xoa bóp bấm huyệt");
    const isHydroacupuncture = procedure.toLowerCase().includes("thủy châm") || procedure.toLowerCase().includes("thuỷ châm");
    if (isElectroacupuncture || isMassage || isHydroacupuncture) {
        return assistant.trim() !== "";
    }
    return true;
}

function getStandardDuration(procedure) {
    if (!procedure) return null;
    const lowerProc = procedure.toLowerCase();
    for (let rule of durationConfig) {
        if (lowerProc.includes(rule.keyword.toLowerCase())) {
            return rule.minutes;
        }
    }
    return null;
}

function validateDuration(record) {
    if (!record.startDate || !record.endDate) return true;
    const durationMinutes = (record.endDate - record.startDate) / (1000 * 60);
    const required = getStandardDuration(record.phuongPhap);
    if (required === null) return true;
    return Math.abs(durationMinutes - required) < 0.1;
}

function validateMachineAllowed(record) {
    const procedure = record.phuongPhap || "";
    const machine = record.machine || "";
    if (!procedure || !machine) return true;
    return isMachineAllowed(procedure, machine);
}

// ========== TỔNG HỢP LỖI CHI TIẾT ==========
function computeAllErrorsWithDetails() {
    if (!rawData.length) return [];

    const doctorConflicts = getDoctorConflictRecordsWithDetails();
    const machineConflicts = getMachineConflictRecordsWithDetails();
    const doctorConflictIndices = new Set(doctorConflicts.map(r => r.originalIndex));
    const machineConflictIndices = new Set(machineConflicts.map(r => r.originalIndex));

    const doctorDetailMap = new Map();
    doctorConflicts.forEach(c => { doctorDetailMap.set(c.originalIndex, c.conflictDetail); });
    const machineDetailMap = new Map();
    machineConflicts.forEach(c => { machineDetailMap.set(c.originalIndex, c.conflictDetail); });

    const result = [];
    for (let i = 0; i < rawData.length; i++) {
        const rec = rawData[i];
        const errors = [];
        const errorDetails = [];

        if (doctorConflictIndices.has(i)) {
            errors.push("Xung đột bác sĩ");
            errorDetails.push(doctorDetailMap.get(i) || "Xung đột lịch bác sĩ");
        }
        if (machineConflictIndices.has(i)) {
            errors.push("Xung đột máy (thời gian)");
            errorDetails.push(machineDetailMap.get(i) || "Xung đột thời gian sử dụng máy");
        }
        if (!validateMachineAllowed(rec)) {
            errors.push("Máy không được phép");
            let allowedList = "không có cấu hình";
            for (let rule of machineMappingConfig) {
                if (rec.phuongPhap.toLowerCase().includes(rule.keyword.toLowerCase())) {
                    if (rule.machines && rule.machines.trim() !== "") {
                        allowedList = rule.machines;
                    }
                    break;
                }
            }
            errorDetails.push(`Máy "${rec.machine}" không được phép cho thủ thuật này. Máy cho phép: ${allowedList}`);
        }
        if (!validateSequence(rec)) {
            errors.push("Trình tự sai");
            errorDetails.push("Trình tự thủ thuật không chứa từ khóa đúng");
        }
        if (!validateDiagnosisEvolution(rec)) {
            errors.push("Diễn biến sai");
            errorDetails.push("Diễn biến không phù hợp với chẩn đoán");
        }
        if (!validateAssistant(rec)) {
            errors.push("Thiếu người phụ");
            errorDetails.push("Thiếu bác sĩ phụ (bắt buộc đối với điện châm, xoa bóp, thủy châm)");
        }
        if (!validateDuration(rec)) {
            errors.push("Thời gian sai");
            const required = getStandardDuration(rec.phuongPhap);
            const actual = rec.startDate && rec.endDate ? Math.round((rec.endDate - rec.startDate) / (1000 * 60)) : '?';
            errorDetails.push(`Thời gian thực hiện không đúng định mức (yêu cầu ${required} phút, thực tế ${actual} phút)`);
        }

        let groupColor = null;
        const conflictRec = doctorConflicts.find(c => c.originalIndex === i) || machineConflicts.find(c => c.originalIndex === i);
        if (conflictRec) groupColor = conflictRec.groupColor;

        result.push({
            ...rec,
            errors: errors,
            errorString: errors.join(", "),
            errorDetailString: errorDetails.join("; "),
            originalIndex: i,
            groupColor: groupColor
        });
    }
    return result;
}

// ========== RENDER BẢNG VỚI DROPDOWN FILTER ==========
let currentDisplayData = [];
let currentRenderMode = "normal";

function getUniqueValuesForColumn(colIndex, data, showErrorColumn) {
    const values = new Set();
    for (let row of data) {
        let val = "";
        switch (colIndex) {
            case 0: val = row.stt || ""; break;
            case 1: val = row.maKCB || ""; break;
            case 2: val = row.hoTen || ""; break;
            case 3: val = row.phuongPhap || ""; break;
            case 4: val = row.trinhTu || ""; break;
            case 5: val = row.chanDoan || ""; break;
            case 6: val = row.dienBien || ""; break;
            case 7: val = row.startTimeRaw || ""; break;
            case 8: val = row.endTimeRaw || ""; break;
            case 9: val = row.doctor || ""; break;
            case 10: val = row.assistantDoctor || ""; break;
            case 11: val = row.machine || ""; break;
            case 12: if (showErrorColumn) val = row.errorDetailString || row.errorString || ""; break;
            default: val = "";
        }
        if (val !== "") values.add(val);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function renderTableWithFilters(data, showErrorColumn = false, titlePrefix = "") {
    const thead = document.getElementById("tableHeader");
    const tbody = document.getElementById("tableBody");
    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="${showErrorColumn ? 13 : 12}" class="empty-msg">📭 Không có dữ liệu hiển thị</td></tr>`;
        thead.innerHTML = "";
        document.getElementById("statsArea").innerHTML = `📋 Không có dữ liệu.`;
        return;
    }

    // Loại bỏ cột Tuổi và Địa chỉ
    const baseColumns = [
        "STT", "Mã KCB", "Họ tên", "Phương pháp thủ thuật",
        "Trình tự", "Chẩn đoán", "Diễn biến", "Ngày giờ bắt đầu", "Ngày giờ kết thúc",
        "Bác sỹ thủ thuật", "Bác sĩ phụ", "Máy TH"
    ];
    if (showErrorColumn) baseColumns.push("Mô tả lỗi");

    thead.innerHTML = "";
    const headerRow = document.createElement("tr");
    baseColumns.forEach(col => {
        const th = document.createElement("th");
        th.textContent = col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const filterRow = document.createElement("tr");
    filterRow.className = "filter-row";
    for (let i = 0; i < baseColumns.length; i++) {
        const td = document.createElement("th");
        const select = document.createElement("select");
        select.setAttribute("data-col-index", i);
        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "(Tất cả)";
        select.appendChild(allOption);
        td.appendChild(select);
        filterRow.appendChild(td);
    }
    thead.appendChild(filterRow);

    currentDisplayData = data;
    currentRenderMode = showErrorColumn ? "errors" : "normal";

    function refreshDropdowns() {
        const filters = getCurrentFilters();
        let filteredTemp = data.filter(row => passesFilters(row, filters, showErrorColumn));
        for (let i = 0; i < baseColumns.length; i++) {
            const select = filterRow.querySelector(`select[data-col-index="${i}"]`);
            if (!select) continue;
            const currentValue = select.value;
            const uniqueVals = getUniqueValuesForColumn(i, filteredTemp, showErrorColumn);
            while (select.options.length > 1) select.remove(1);
            for (let val of uniqueVals) {
                const option = document.createElement("option");
                option.value = val;
                option.textContent = val;
                select.appendChild(option);
            }
            if (currentValue && Array.from(select.options).some(opt => opt.value === currentValue)) {
                select.value = currentValue;
            } else {
                select.value = "";
            }
        }
    }

    function getCurrentFilters() {
        const filters = {};
        for (let i = 0; i < baseColumns.length; i++) {
            const select = filterRow.querySelector(`select[data-col-index="${i}"]`);
            if (select && select.value !== "") {
                filters[i] = select.value;
            }
        }
        return filters;
    }

    function passesFilters(row, filters, showErrCol) {
        for (let [colIdx, filterVal] of Object.entries(filters)) {
            let cellVal = "";
            const idx = parseInt(colIdx);
            switch (idx) {
                case 0: cellVal = row.stt || ""; break;
                case 1: cellVal = row.maKCB || ""; break;
                case 2: cellVal = row.hoTen || ""; break;
                case 3: cellVal = row.phuongPhap || ""; break;
                case 4: cellVal = row.trinhTu || ""; break;
                case 5: cellVal = row.chanDoan || ""; break;
                case 6: cellVal = row.dienBien || ""; break;
                case 7: cellVal = row.startTimeRaw || ""; break;
                case 8: cellVal = row.endTimeRaw || ""; break;
                case 9: cellVal = row.doctor || ""; break;
                case 10: cellVal = row.assistantDoctor || ""; break;
                case 11: cellVal = row.machine || ""; break;
                case 12: if (showErrCol) cellVal = row.errorDetailString || row.errorString || ""; break;
                default: cellVal = "";
            }
            if (cellVal.toLowerCase() !== filterVal.toLowerCase()) return false;
        }
        return true;
    }

    function renderBody() {
        const filters = getCurrentFilters();
        const filteredData = data.filter(row => passesFilters(row, filters, showErrorColumn));
        tbody.innerHTML = "";
        for (let rec of filteredData) {
            const row = tbody.insertRow();
            if (rec.groupColor) row.style.backgroundColor = rec.groupColor;

            row.insertCell(0).innerText = rec.stt || "";
            row.insertCell(1).innerText = rec.maKCB || "";
            row.insertCell(2).innerText = rec.hoTen || "";
            row.insertCell(3).innerText = rec.phuongPhap || "";
            let cell4 = row.insertCell(4);
            let full4 = rec.trinhTu || "";
            cell4.innerText = truncateText(full4);
            cell4.setAttribute("data-fulltext", full4);
            let cell5 = row.insertCell(5);
            let full5 = rec.chanDoan || "";
            cell5.innerText = truncateText(full5);
            cell5.setAttribute("data-fulltext", full5);
            let cell6 = row.insertCell(6);
            let full6 = rec.dienBien || "";
            cell6.innerText = truncateText(full6);
            cell6.setAttribute("data-fulltext", full6);
            row.insertCell(7).innerText = rec.startTimeRaw || "";
            row.insertCell(8).innerText = rec.endTimeRaw || "";
            row.insertCell(9).innerText = rec.doctor || "";
            row.insertCell(10).innerText = rec.assistantDoctor || "";
            row.insertCell(11).innerText = rec.machine || "";
            if (showErrorColumn) {
                let errorCell = row.insertCell(12);
                errorCell.innerText = rec.errorDetailString || rec.errorString || "";
                if (rec.errorDetailString) errorCell.style.fontWeight = "bold";
            }
        }
        const statsDiv = document.getElementById("statsArea");
        if (showErrorColumn) {
            const totalErrors = filteredData.filter(r => r.errorString).length;
            statsDiv.innerHTML = `⚠️ <strong>${titlePrefix || "Kết quả lọc"}</strong> : Tổng số bản ghi có lỗi: <strong>${totalErrors}</strong> / ${filteredData.length}.`;
        } else {
            statsDiv.innerHTML = `📋 Hiển thị <strong>${filteredData.length}</strong> bản ghi từ file.`;
        }
        attachDoubleClickToCells();
        refreshDropdowns();
    }

    for (let i = 0; i < baseColumns.length; i++) {
        const select = filterRow.querySelector(`select[data-col-index="${i}"]`);
        if (select) {
            select.addEventListener("change", () => renderBody());
        }
    }

    refreshDropdowns();
    renderBody();
}

function resetAllFilters() {
    const filterRow = document.querySelector("#tableHeader .filter-row");
    if (filterRow) {
        const selects = filterRow.querySelectorAll("select");
        selects.forEach(select => { select.value = ""; });
        selects.forEach(select => {
            select.dispatchEvent(new Event('change'));
        });
    }
}

function renderAllData() {
    if (!rawData.length) {
        document.getElementById("tableBody").innerHTML = `<tr><td colspan="12" class="empty-msg">📂 Chưa có dữ liệu, hãy tải file Excel trước.</td></tr>`;
        document.getElementById("statsArea").innerHTML = `📌 Chọn file Excel để bắt đầu.`;
        return;
    }
    renderTableWithFilters(rawData, false, "Toàn bộ dữ liệu");
}

function renderConflictRecords(records, title, showErrorColumn = true) {
    if (!records.length) {
        document.getElementById("tableBody").innerHTML = `<tr><td colspan="${showErrorColumn ? 13 : 12}" class="empty-msg">✨ Không tìm thấy xung đột.</td></tr>`;
        document.getElementById("statsArea").innerHTML = `✅ ${title}: không có xung đột.`;
        return;
    }
    const enriched = records.map(rec => ({
        ...rec,
        errorString: "Xung đột",
        errorDetailString: rec.conflictDetail || "Xung đột thời gian"
    }));
    renderTableWithFilters(enriched, showErrorColumn, title);
}

function renderValidationErrors(validator, title) {
    if (!rawData.length) {
        alert("Vui lòng tải file Excel trước.");
        return;
    }
    const allWithDetails = computeAllErrorsWithDetails();
    let errors = allWithDetails.filter(rec => {
        if (validator === validateSequence) return rec.errors.includes("Trình tự sai");
        if (validator === validateDiagnosisEvolution) return rec.errors.includes("Diễn biến sai");
        if (validator === validateAssistant) return rec.errors.includes("Thiếu người phụ");
        if (validator === validateDuration) return rec.errors.includes("Thời gian sai");
        if (validator === validateMachineAllowed) return rec.errors.includes("Máy không được phép");
        return false;
    });
    if (errors.length === 0) {
        document.getElementById("tableBody").innerHTML = `<tr><td colspan="13" class="empty-msg">✅ Không tìm thấy lỗi.</td></tr>`;
        document.getElementById("statsArea").innerHTML = `✅ ${title}: không có lỗi.`;
    } else {
        renderTableWithFilters(errors, true, title);
    }
}

function filterAllErrors() {
    if (!rawData.length) {
        alert("Vui lòng tải file Excel trước.");
        return;
    }
    const allWithErrors = computeAllErrorsWithDetails();
    const onlyErrors = allWithErrors.filter(r => r.errors.length > 0);
    if (onlyErrors.length === 0) {
        document.getElementById("tableBody").innerHTML = `<tr><td colspan="13" class="empty-msg">✅ Không phát hiện lỗi nào.</td></tr>`;
        document.getElementById("statsArea").innerHTML = `✅ Lọc tổng hợp: không có lỗi.`;
    } else {
        renderTableWithFilters(onlyErrors, true, "KẾT QUẢ LỌC TỔNG HỢP (các bản ghi có lỗi)");
    }
}

function exportToExcel() {
    if (!rawData.length) {
        alert("Không có dữ liệu để xuất.");
        return;
    }
    const allWithErrors = computeAllErrorsWithDetails();
    const sheetData = [];
    const headers = [
        "STT", "Mã KCB", "Họ tên", "Phương pháp thủ thuật",
        "Trình tự", "Chẩn đoán", "Diễn biến", "Ngày giờ bắt đầu", "Ngày giờ kết thúc",
        "Bác sỹ thủ thuật", "Bác sĩ phụ", "Máy TH", "Các lỗi", "Mô tả chi tiết"
    ];
    sheetData.push(headers);
    for (let rec of allWithErrors) {
        sheetData.push([
            rec.stt || "", rec.maKCB || "", rec.hoTen || "",
            rec.phuongPhap || "", rec.trinhTu || "", rec.chanDoan || "", rec.dienBien || "",
            rec.startTimeRaw || "", rec.endTimeRaw || "", rec.doctor || "", rec.assistantDoctor || "",
            rec.machine || "", rec.errorString || "", rec.errorDetailString || ""
        ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BaoCaoLoi");
    XLSX.writeFile(wb, `BaoCao_Loi_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`);
}

// ========== PARSE EXCEL ==========
function parseExcelAndStore(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 9) throw new Error("File không đủ dòng, cần ít nhất 9 dòng (dòng 8 là header)");

    const headerRow = rows[7];
    if (!headerRow || !Array.isArray(headerRow)) throw new Error("Không tìm thấy dòng tiêu đề (dòng 8)");
    headers = headerRow.map(cell => (cell ? String(cell).trim() : ""));
    populateMappingDropdowns();
    loadMappingFromStorage();
    loadThresholdConfig();
    loadMachineCapacityConfig();

    const dataRows = rows.slice(8);
    const parsed = [];
    for (let row of dataRows) {
        if (!row || row.length === 0) continue;
        const stt = getValueByMapping(row, "stt");
        const maKCB = getValueByMapping(row, "maKCB");
        const hoTen = getValueByMapping(row, "hoTen");
        const phuongPhap = getValueByMapping(row, "phuongPhap");
        const trinhTu = getValueByMapping(row, "trinhTu");
        const chanDoan = getValueByMapping(row, "chanDoan");
        const dienBien = getValueByMapping(row, "dienBien");
        const startRaw = getValueByMapping(row, "startTime");
        const endRaw = getValueByMapping(row, "endTime");
        const doctor = getValueByMapping(row, "doctor");
        const assistantDoctor = getValueByMapping(row, "assistantDoctor");
        const machine = getValueByMapping(row, "machine");

        if (!startRaw || !endRaw) continue;
        const startDate = parseDateTime(startRaw);
        const endDate = parseDateTime(endRaw);
        if (!startDate || !endDate) continue;

        parsed.push({
            stt, maKCB, hoTen,
            phuongPhap, trinhTu, chanDoan, dienBien,
            startTimeRaw: startRaw, endTimeRaw: endRaw,
            startDate, endDate, doctor, assistantDoctor, machine,
            threshold: getProcedureThreshold(phuongPhap)
        });
    }
    if (parsed.length === 0) throw new Error("Không có dòng dữ liệu hợp lệ");
    rawData = parsed;
    document.getElementById("fileStatus").innerHTML = "✅ Đã tải: " + (workbook.SheetNames[0] || "file");
    document.getElementById("rowCount").innerHTML = `${rawData.length} bản ghi`;
    renderAllData();
    updateModalPersonSelect();
}

function getValueByMapping(row, fieldId) {
    const mapping = currentMapping[fieldId];
    if (mapping === undefined || mapping === -1) return "";
    const val = row[mapping];
    return (val !== undefined && val !== null) ? String(val).trim() : "";
}

function populateMappingDropdowns() {
    FIELDS.forEach(field => {
        const select = document.getElementById(`col${field.id.charAt(0).toUpperCase() + field.id.slice(1)}`);
        if (!select) return;
        select.innerHTML = '<option value="-1">-- Chọn cột --</option>';
        headers.forEach((header, idx) => {
            const option = document.createElement("option");
            option.value = idx;
            option.textContent = `${header} (${String.fromCharCode(65 + idx)})`;
            select.appendChild(option);
        });
    });
}

function saveMappingToStorage() {
    const mapping = {};
    FIELDS.forEach(field => {
        const select = document.getElementById(`col${field.id.charAt(0).toUpperCase() + field.id.slice(1)}`);
        if (select) mapping[field.id] = parseInt(select.value, 10);
        else mapping[field.id] = -1;
    });
    localStorage.setItem("yhct_column_mapping", JSON.stringify(mapping));
    currentMapping = mapping;
}

function loadMappingFromStorage() {
    const saved = localStorage.getItem("yhct_column_mapping");
    let mapping = saved ? JSON.parse(saved) : {};
    FIELDS.forEach(field => {
        if (mapping[field.id] === undefined) mapping[field.id] = field.defaultIdx;
        const select = document.getElementById(`col${field.id.charAt(0).toUpperCase() + field.id.slice(1)}`);
        if (select) select.value = mapping[field.id];
    });
    currentMapping = mapping;
}

// ========== CẤU HÌNH THỜI GIAN GỐI ==========
function loadThresholdConfig() {
    const saved = localStorage.getItem("yhct_threshold_config_list");
    if (saved) {
        thresholdConfig = JSON.parse(saved);
    } else {
        thresholdConfig = [
            { keyword: "hồng ngoại", minutes: 3 },
            { keyword: "dòng điện xung", minutes: 3 },
            { keyword: "điện xung", minutes: 3 },
            { keyword: "giao thoa", minutes: 3 },
            { keyword: "điện châm", minutes: 7 },
            { keyword: "thủy châm", minutes: 12 },
            { keyword: "thuỷ châm", minutes: 12 }
        ];
    }
    renderThresholdConfigList();
}

function saveThresholdConfig() {
    localStorage.setItem("yhct_threshold_config_list", JSON.stringify(thresholdConfig));
    renderThresholdConfigList();
    rawData.forEach(item => {
        item.threshold = getProcedureThreshold(item.phuongPhap);
    });
}

function renderThresholdConfigList() {
    const container = document.getElementById("thresholdConfigList");
    if (!container) return;
    container.innerHTML = "";
    thresholdConfig.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "config-item";
        div.innerHTML = `
            <span><strong>${escapeHtml(item.keyword)}</strong>: ${item.minutes} phút</span>
            <button class="btn btn-sm edit-threshold" data-idx="${idx}">✏️</button>
            <button class="btn btn-sm delete-threshold" data-idx="${idx}">🗑️</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll(".edit-threshold").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            const item = thresholdConfig[idx];
            const newKw = prompt("Từ khóa thủ thuật:", item.keyword);
            if (newKw && newKw.trim()) {
                const newMin = parseInt(prompt("Số phút gối tối thiểu:", item.minutes), 10);
                if (!isNaN(newMin) && newMin >= 0) {
                    thresholdConfig[idx] = { keyword: newKw.trim(), minutes: newMin };
                    saveThresholdConfig();
                }
            }
        });
    });
    document.querySelectorAll(".delete-threshold").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm("Xóa cấu hình này?")) {
                thresholdConfig.splice(idx, 1);
                saveThresholdConfig();
            }
        });
    });
}

function importThresholdConfigFromExcel(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 2) throw new Error("File cấu hình phải có ít nhất 2 dòng");
    const newConfig = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const keyword = row[0] ? String(row[0]).trim() : "";
        const minutes = parseInt(row[1], 10);
        if (keyword && !isNaN(minutes) && minutes >= 0) {
            newConfig.push({ keyword, minutes });
        }
    }
    if (newConfig.length) {
        thresholdConfig = newConfig;
        saveThresholdConfig();
        alert(`Đã import ${newConfig.length} cấu hình thời gian gối.`);
    } else {
        alert("Không tìm thấy dữ liệu hợp lệ.");
    }
}

// ========== CẤU HÌNH MÁY CHO PHÉP ==========
function loadMachineMappingConfig() {
    const saved = localStorage.getItem("yhct_machine_mapping_list");
    if (saved) {
        machineMappingConfig = JSON.parse(saved);
    } else {
        machineMappingConfig = [
            { keyword: "điện châm", machines: "2303-2112,2303-2108,2303-2126,2303-2130,2206-0313,2206-0307,2206-0297" },
            { keyword: "thủy châm", machines: "" },
            { keyword: "thuỷ châm", machines: "" }
        ];
    }
    renderMachineMappingList();
}

function saveMachineMappingConfig() {
    localStorage.setItem("yhct_machine_mapping_list", JSON.stringify(machineMappingConfig));
    renderMachineMappingList();
}

function renderMachineMappingList() {
    const container = document.getElementById("machineMappingList");
    if (!container) return;
    container.innerHTML = "";
    machineMappingConfig.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "config-item";
        div.innerHTML = `
            <span><strong>${escapeHtml(item.keyword)}</strong>: ${escapeHtml(item.machines || "")}</span>
            <button class="btn btn-sm edit-machine" data-idx="${idx}">✏️</button>
            <button class="btn btn-sm delete-machine" data-idx="${idx}">🗑️</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll(".edit-machine").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            const item = machineMappingConfig[idx];
            const newKw = prompt("Từ khóa thủ thuật:", item.keyword);
            if (newKw && newKw.trim()) {
                const newMachines = prompt("Danh sách máy cho phép (cách nhau dấu phẩy):", item.machines || "");
                if (newMachines !== null) {
                    machineMappingConfig[idx] = { keyword: newKw.trim(), machines: newMachines.trim() };
                    saveMachineMappingConfig();
                }
            }
        });
    });
    document.querySelectorAll(".delete-machine").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm("Xóa cấu hình này?")) {
                machineMappingConfig.splice(idx, 1);
                saveMachineMappingConfig();
            }
        });
    });
}

function importMachineMappingFromExcel(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 2) throw new Error("File cấu hình phải có ít nhất 2 dòng");
    const newConfig = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const keyword = row[0] ? String(row[0]).trim() : "";
        const machines = row[1] ? String(row[1]).trim() : "";
        if (keyword) {
            newConfig.push({ keyword, machines });
        }
    }
    if (newConfig.length) {
        machineMappingConfig = newConfig;
        saveMachineMappingConfig();
        alert(`Đã import ${newConfig.length} cấu hình máy.`);
    } else {
        alert("Không tìm thấy dữ liệu hợp lệ.");
    }
}

// ========== CẤU HÌNH CÔNG SUẤT MÁY (mới) ==========
function loadMachineCapacityConfig() {
    const saved = localStorage.getItem("yhct_machine_capacity_list");
    if (saved) {
        machineCapacityConfig = JSON.parse(saved);
    } else {
        machineCapacityConfig = [
            { keyword: "giao thoa", capacity: 2 },
            { keyword: "điện xung", capacity: 2 }
        ];
    }
    renderMachineCapacityList();
}

function saveMachineCapacityConfig() {
    localStorage.setItem("yhct_machine_capacity_list", JSON.stringify(machineCapacityConfig));
    renderMachineCapacityList();
}

function renderMachineCapacityList() {
    const container = document.getElementById("machineCapacityList");
    if (!container) return;
    container.innerHTML = "";
    machineCapacityConfig.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "config-item";
        div.innerHTML = `
            <span><strong>${escapeHtml(item.keyword)}</strong>: ${item.capacity} ca</span>
            <button class="btn btn-sm edit-capacity" data-idx="${idx}">✏️</button>
            <button class="btn btn-sm delete-capacity" data-idx="${idx}">🗑️</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll(".edit-capacity").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            const item = machineCapacityConfig[idx];
            const newKw = prompt("Từ khóa máy:", item.keyword);
            if (newKw && newKw.trim()) {
                const newCap = parseInt(prompt("Công suất (số ca tối đa):", item.capacity), 10);
                if (!isNaN(newCap) && newCap >= 1) {
                    machineCapacityConfig[idx] = { keyword: newKw.trim(), capacity: newCap };
                    saveMachineCapacityConfig();
                }
            }
        });
    });
    document.querySelectorAll(".delete-capacity").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm("Xóa cấu hình này?")) {
                machineCapacityConfig.splice(idx, 1);
                saveMachineCapacityConfig();
            }
        });
    });
}

function importMachineCapacityFromExcel(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 2) throw new Error("File cấu hình phải có ít nhất 2 dòng");
    const newConfig = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const keyword = row[0] ? String(row[0]).trim() : "";
        const capacity = parseInt(row[1], 10);
        if (keyword && !isNaN(capacity) && capacity >= 1) {
            newConfig.push({ keyword, capacity });
        }
    }
    if (newConfig.length) {
        machineCapacityConfig = newConfig;
        saveMachineCapacityConfig();
        alert(`Đã import ${newConfig.length} cấu hình công suất máy.`);
    } else {
        alert("Không tìm thấy dữ liệu hợp lệ.");
    }
}

// ========== CÁC CẤU HÌNH KHÁC (giữ nguyên) ==========
function loadDurationConfig() {
    const saved = localStorage.getItem("yhct_duration_config_list");
    if (saved) {
        durationConfig = JSON.parse(saved);
    } else {
        durationConfig = [
            { keyword: "điện châm", minutes: 27 },
            { keyword: "thủy châm", minutes: 25 },
            { keyword: "thuỷ châm", minutes: 25 },
            { keyword: "xoa bóp bấm huyệt", minutes: 30 },
            { keyword: "hồng ngoại", minutes: 15 },
            { keyword: "điện xung", minutes: 15 },
            { keyword: "giao thoa", minutes: 15 },
            { keyword: "điện phân", minutes: 15 },
            { keyword: "xoa bóp vùng", minutes: 15 }
        ];
    }
    renderDurationConfigList();
}

function saveDurationConfig() {
    localStorage.setItem("yhct_duration_config_list", JSON.stringify(durationConfig));
    renderDurationConfigList();
}

function renderDurationConfigList() {
    const container = document.getElementById("durationConfigList");
    if (!container) return;
    container.innerHTML = "";
    durationConfig.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "config-item";
        div.innerHTML = `
            <span><strong>${escapeHtml(item.keyword)}</strong>: ${item.minutes} phút</span>
            <button class="btn btn-sm edit-duration" data-idx="${idx}">✏️</button>
            <button class="btn btn-sm delete-duration" data-idx="${idx}">🗑️</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll(".edit-duration").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            const item = durationConfig[idx];
            const newKw = prompt("Từ khóa thủ thuật:", item.keyword);
            if (newKw && newKw.trim()) {
                const newMin = parseInt(prompt("Số phút yêu cầu:", item.minutes), 10);
                if (!isNaN(newMin) && newMin > 0) {
                    durationConfig[idx] = { keyword: newKw.trim(), minutes: newMin };
                    saveDurationConfig();
                }
            }
        });
    });
    document.querySelectorAll(".delete-duration").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm("Xóa quy tắc này?")) {
                durationConfig.splice(idx, 1);
                saveDurationConfig();
            }
        });
    });
}

function importDurationConfigFromExcel(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 2) throw new Error("File cấu hình phải có ít nhất 2 dòng");
    const newConfig = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const keyword = row[0] ? String(row[0]).trim() : "";
        const minutes = parseInt(row[1], 10);
        if (keyword && !isNaN(minutes) && minutes > 0) {
            newConfig.push({ keyword, minutes });
        }
    }
    if (newConfig.length) {
        durationConfig = newConfig;
        saveDurationConfig();
        alert(`Đã import ${newConfig.length} quy tắc thời gian.`);
    } else {
        alert("Không tìm thấy dữ liệu hợp lệ.");
    }
}

function loadSequenceConfig() {
    const saved = localStorage.getItem("yhct_sequence_config");
    sequenceConfig = saved ? JSON.parse(saved) : [];
    renderSequenceConfigList();
}
function saveSequenceConfig() {
    localStorage.setItem("yhct_sequence_config", JSON.stringify(sequenceConfig));
    renderSequenceConfigList();
}
function renderSequenceConfigList() {
    const container = document.getElementById("sequenceConfigList");
    if (!container) return;
    container.innerHTML = "";
    sequenceConfig.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "config-item";
        div.innerHTML = `
            <span><strong>${escapeHtml(item.name)}</strong>: ${escapeHtml(item.keywords)}</span>
            <button class="btn btn-sm edit-seq" data-idx="${idx}">✏️</button>
            <button class="btn btn-sm delete-seq" data-idx="${idx}">🗑️</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll(".edit-seq").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            const item = sequenceConfig[idx];
            const newName = prompt("Tên thủ thuật:", item.name);
            if (newName !== null && newName.trim()) {
                const newKw = prompt("Từ khóa (cách nhau dấu phẩy):", item.keywords);
                if (newKw !== null) {
                    sequenceConfig[idx] = { name: newName.trim(), keywords: newKw.trim() };
                    saveSequenceConfig();
                }
            }
        });
    });
    document.querySelectorAll(".delete-seq").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm("Xóa cấu hình này?")) {
                sequenceConfig.splice(idx, 1);
                saveSequenceConfig();
            }
        });
    });
}
function importSequenceConfigFromExcel(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 2) throw new Error("File cấu hình phải có ít nhất 2 dòng");
    const newConfig = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const name = row[0] ? String(row[0]).trim() : "";
        const keywords = row[1] ? String(row[1]).trim() : "";
        if (name && keywords) newConfig.push({ name, keywords });
    }
    if (newConfig.length) {
        sequenceConfig = newConfig;
        saveSequenceConfig();
        alert(`Đã import ${newConfig.length} cấu hình trình tự.`);
    } else {
        alert("Không tìm thấy dữ liệu hợp lệ.");
    }
}

function loadEvolutionConfig() {
    const saved = localStorage.getItem("yhct_evolution_config");
    evolutionConfig = saved ? JSON.parse(saved) : [];
    renderEvolutionConfigList();
}
function saveEvolutionConfig() {
    localStorage.setItem("yhct_evolution_config", JSON.stringify(evolutionConfig));
    renderEvolutionConfigList();
}
function renderEvolutionConfigList() {
    const container = document.getElementById("evolutionConfigList");
    if (!container) return;
    container.innerHTML = "";
    evolutionConfig.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "config-item";
        div.innerHTML = `
            <span><strong>${escapeHtml(item.disease)}</strong>: ${escapeHtml(item.keywords)}</span>
            <button class="btn btn-sm edit-evo" data-idx="${idx}">✏️</button>
            <button class="btn btn-sm delete-evo" data-idx="${idx}">🗑️</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll(".edit-evo").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            const item = evolutionConfig[idx];
            const newDisease = prompt("Tên bệnh:", item.disease);
            if (newDisease !== null && newDisease.trim()) {
                const newKw = prompt("Từ khóa (cách nhau dấu phẩy):", item.keywords);
                if (newKw !== null) {
                    evolutionConfig[idx] = { disease: newDisease.trim(), keywords: newKw.trim() };
                    saveEvolutionConfig();
                }
            }
        });
    });
    document.querySelectorAll(".delete-evo").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm("Xóa cấu hình này?")) {
                evolutionConfig.splice(idx, 1);
                saveEvolutionConfig();
            }
        });
    });
}
function importEvolutionConfigFromExcel(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows || rows.length < 2) throw new Error("File cấu hình phải có ít nhất 2 dòng");
    const newConfig = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const disease = row[0] ? String(row[0]).trim() : "";
        const keywords = row[1] ? String(row[1]).trim() : "";
        if (disease && keywords) newConfig.push({ disease, keywords });
    }
    if (newConfig.length) {
        evolutionConfig = newConfig;
        saveEvolutionConfig();
        alert(`Đã import ${newConfig.length} cấu hình diễn biến.`);
    } else {
        alert("Không tìm thấy dữ liệu hợp lệ.");
    }
}

// ========== MODAL BIỂU ĐỒ ==========
const modalChart = document.getElementById("chartModal");
const openChartBtn = document.getElementById("openChartBtn");
const closeChartSpan = document.querySelector("#chartModal .close");
openChartBtn.onclick = () => modalChart.style.display = "block";
closeChartSpan.onclick = () => modalChart.style.display = "none";

function updateModalPersonSelect() {
    const chartType = document.getElementById("modalChartType").value;
    const select = document.getElementById("modalPersonSelect");
    if (!rawData.length) { select.innerHTML = '<option value="">-- Chưa có dữ liệu --</option>'; return; }
    let items = new Set();
    rawData.forEach(item => {
        if (chartType === "doctor" && item.doctor) items.add(item.doctor);
        else if (chartType === "machine" && item.machine) items.add(item.machine);
    });
    const sorted = Array.from(items).sort();
    select.innerHTML = '<option value="">-- Chọn --</option>' + sorted.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}

function escapeHtml(str) { return str.replace(/[&<>]/g, function (m) { return m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'; }); }

document.getElementById("modalChartType").addEventListener("change", updateModalPersonSelect);

let isDragging = false;
let startX, startY, scrollLeft, scrollTop;
function enableDragScroll(container) {
    container.addEventListener("mousedown", (e) => {
        isDragging = true;
        startX = e.pageX - container.offsetLeft;
        startY = e.pageY - container.offsetTop;
        scrollLeft = container.scrollLeft;
        scrollTop = container.scrollTop;
        container.style.cursor = "grabbing";
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const x = e.pageX - container.offsetLeft;
        const y = e.pageY - container.offsetTop;
        const walkX = (x - startX);
        const walkY = (y - startY);
        container.scrollLeft = scrollLeft - walkX;
        container.scrollTop = scrollTop - walkY;
    });
    window.addEventListener("mouseup", () => {
        isDragging = false;
        container.style.cursor = "grab";
    });
    container.style.cursor = "grab";
}

function drawTimeline() {
    const selectedName = document.getElementById("modalPersonSelect").value;
    const chartType = document.getElementById("modalChartType").value;
    const shiftType = document.getElementById("modalShiftSelect").value;
    if (!selectedName) { alert("Vui lòng chọn bác sĩ hoặc máy."); return; }

    const procedures = rawData.filter(item =>
        chartType === "doctor" ? item.doctor === selectedName : item.machine === selectedName
    );
    if (!procedures.length) {
        document.getElementById("chartMessage").style.display = "block";
        document.getElementById("chartMessage").innerHTML = "⚠️ Không có dữ liệu thủ thuật cho đối tượng này.";
        document.getElementById("timelineTableContainer").style.display = "none";
        return;
    }
    procedures.sort((a, b) => a.startDate - b.startDate);

    let minHour = 7, maxHour = 17;
    if (shiftType === "winter") {
        minHour = 7.5;
        maxHour = 16.5;
    } else {
        minHour = 7;
        maxHour = 17;
    }
    const startMinutes = minHour * 60;
    const endMinutes = maxHour * 60;
    const minuteStep = 5;
    const totalSlots = Math.ceil((endMinutes - startMinutes) / minuteStep);

    const timeHeaders = [];
    for (let i = 0; i <= totalSlots; i++) {
        const minutes = startMinutes + i * minuteStep;
        if (minutes > endMinutes) break;
        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;
        timeHeaders.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    }

    const container = document.getElementById("timelineTableContainer");
    container.style.display = "block";
    document.getElementById("chartMessage").style.display = "none";
    container.innerHTML = "";

    const table = document.createElement("table");
    table.className = "timeline-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const thFirst = document.createElement("th");
    thFirst.textContent = "Bệnh nhân / Thủ thuật";
    thFirst.className = "sticky-col";
    headerRow.appendChild(thFirst);
    for (let label of timeHeaders) {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let i = 0; i < procedures.length; i++) {
        const proc = procedures[i];
        const row = document.createElement("tr");

        const tdLabel = document.createElement("td");
        tdLabel.textContent = `${proc.hoTen.substring(0, 22)} - ${proc.phuongPhap.substring(0, 28)}`;
        tdLabel.className = "sticky-col";
        row.appendChild(tdLabel);

        const startProcMin = proc.startDate.getHours() * 60 + proc.startDate.getMinutes();
        const endProcMin = proc.endDate.getHours() * 60 + proc.endDate.getMinutes();

        for (let slotIdx = 0; slotIdx < timeHeaders.length; slotIdx++) {
            const slotStartMin = startMinutes + slotIdx * minuteStep;
            const slotEndMin = slotStartMin + minuteStep;
            const td = document.createElement("td");
            if (startProcMin < slotEndMin && endProcMin > slotStartMin) {
                td.className = "occupied";
                td.title = `${proc.startTimeRaw} → ${proc.endTimeRaw}`;
                if (slotIdx % 6 === 0) td.textContent = "●";
            } else {
                td.className = "free";
            }
            row.appendChild(td);
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    const shift = shiftType === "winter"
        ? { morning: { start: 7.5, end: 12 }, afternoon: { start: 13, end: 16.5 } }
        : { morning: { start: 7, end: 11.5 }, afternoon: { start: 13.5, end: 17 } };

    let busyIntervals = procedures.map(p => ({
        start: p.startDate.getHours() + p.startDate.getMinutes() / 60,
        end: p.endDate.getHours() + p.endDate.getMinutes() / 60
    }));
    busyIntervals.sort((a, b) => a.start - b.start);

    function getFreeSlots(shiftStart, shiftEnd) {
        let slots = [], current = shiftStart;
        for (let busy of busyIntervals) {
            if (busy.end <= current) continue;
            if (busy.start > current) slots.push({ start: current, end: Math.min(busy.start, shiftEnd) });
            current = Math.max(current, busy.end);
            if (current >= shiftEnd) break;
        }
        if (current < shiftEnd) slots.push({ start: current, end: shiftEnd });
        return slots.filter(s => s.start < s.end);
    }

    const morningSlots = getFreeSlots(shift.morning.start, shift.morning.end);
    const afternoonSlots = getFreeSlots(shift.afternoon.start, shift.afternoon.end);

    function formatTime(hour) {
        const h = Math.floor(hour);
        const m = Math.round((hour - h) * 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    let freeTableHtml = `<table class="free-time-table"><thead><tr><th>Ca</th><th>Thời gian rảnh từ</th><th>Thời gian rảnh đến</th><th>Số phút</th></tr></thead><tbody>`;
    for (let slot of morningSlots) {
        const minutes = Math.round((slot.end - slot.start) * 60);
        freeTableHtml += `<tr><td>Sáng</td><td>${formatTime(slot.start)}</td><td>${formatTime(slot.end)}</td><td>${minutes} phút</td></tr>`;
    }
    for (let slot of afternoonSlots) {
        const minutes = Math.round((slot.end - slot.start) * 60);
        freeTableHtml += `<tr><td>Chiều</td><td>${formatTime(slot.start)}</td><td>${formatTime(slot.end)}</td><td>${minutes} phút</td></tr>`;
    }
    freeTableHtml += `</tbody></table>`;
    document.getElementById("modalFreeTimeInfo").innerHTML = freeTableHtml;

    enableDragScroll(container);
}

document.getElementById("drawChartBtn").addEventListener("click", drawTimeline);

// ========== SỰ KIỆN ==========
document.getElementById("excelFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        try { parseExcelAndStore(evt.target.result); } catch (err) { alert("Lỗi xử lý file: " + err.message); }
    };
    reader.onerror = () => alert("Không thể đọc file");
    reader.readAsArrayBuffer(file);
});

document.getElementById("filterDoctorBtn").addEventListener("click", () => {
    if (!rawData.length) { alert("Vui lòng tải file Excel trước."); return; }
    const conflicts = getDoctorConflictRecordsWithDetails();
    renderConflictRecords(conflicts, "Xung đột theo Bác sỹ thủ thuật");
});

document.getElementById("filterMachineTimeBtn").addEventListener("click", () => {
    if (!rawData.length) { alert("Vui lòng tải file Excel trước."); return; }
    const conflicts = getMachineConflictRecordsWithDetails();
    renderConflictRecords(conflicts, "Xung đột thời gian sử dụng máy");
});

document.getElementById("filterMachineAllowedBtn").addEventListener("click", () => {
    if (!rawData.length) { alert("Vui lòng tải file Excel trước."); return; }
    renderValidationErrors(validateMachineAllowed, "Máy không được phép");
});

document.getElementById("showAllBtn").addEventListener("click", () => { if (rawData.length) renderAllData(); else alert("Chưa có dữ liệu."); });
document.getElementById("filterSequenceBtn").addEventListener("click", () => renderValidationErrors(validateSequence, "Trình tự sai"));
document.getElementById("filterEvolutionBtn").addEventListener("click", () => renderValidationErrors(validateDiagnosisEvolution, "Diễn biến sai"));
document.getElementById("filterAssistantBtn").addEventListener("click", () => renderValidationErrors(validateAssistant, "Thiếu người phụ"));
document.getElementById("filterDurationBtn").addEventListener("click", () => renderValidationErrors(validateDuration, "Thời gian sai"));
document.getElementById("filterAllBtn").addEventListener("click", filterAllErrors);
document.getElementById("exportReportBtn").addEventListener("click", exportToExcel);

// Nút xóa bộ lọc
const toolbar = document.querySelector(".toolbar");
const resetFilterBtn = document.createElement("button");
resetFilterBtn.className = "btn btn-outline";
resetFilterBtn.innerHTML = "🧹 Xóa bộ lọc";
resetFilterBtn.addEventListener("click", resetAllFilters);
toolbar.appendChild(resetFilterBtn);

// ========== MODAL CẤU HÌNH ==========
const configModal = document.getElementById("configModal");
const openConfigBtn = document.getElementById("openConfigBtn");
const closeConfigSpan = document.querySelector(".close-config");
openConfigBtn.onclick = () => configModal.style.display = "block";
closeConfigSpan.onclick = () => configModal.style.display = "none";
window.onclick = (e) => { if (e.target == configModal) configModal.style.display = "none"; };

// Cấu hình thời gian gối
document.getElementById("addThresholdBtn").addEventListener("click", () => {
    const keyword = document.getElementById("newThresholdKeyword").value.trim();
    const minutes = parseInt(document.getElementById("newThresholdMinutes").value, 10);
    if (!keyword || isNaN(minutes) || minutes < 0) {
        alert("Vui lòng nhập từ khóa và số phút hợp lệ (>=0).");
        return;
    }
    thresholdConfig.push({ keyword, minutes });
    saveThresholdConfig();
    document.getElementById("newThresholdKeyword").value = "";
    document.getElementById("newThresholdMinutes").value = "";
});
document.getElementById("saveThresholdConfigBtn").addEventListener("click", () => saveThresholdConfig());

// Cấu hình máy cho phép
document.getElementById("addMachineMappingBtn").addEventListener("click", () => {
    const keyword = document.getElementById("newMachineKeyword").value.trim();
    const machines = document.getElementById("newMachineList").value.trim();
    if (!keyword) {
        alert("Vui lòng nhập từ khóa thủ thuật.");
        return;
    }
    machineMappingConfig.push({ keyword, machines });
    saveMachineMappingConfig();
    document.getElementById("newMachineKeyword").value = "";
    document.getElementById("newMachineList").value = "";
});
document.getElementById("saveMachineMappingBtn").addEventListener("click", () => saveMachineMappingConfig());
document.getElementById("importMachineMappingBtn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx, .xls";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => { try { importMachineMappingFromExcel(evt.target.result); } catch (err) { alert("Lỗi import: " + err.message); } };
        reader.readAsArrayBuffer(file);
    };
    input.click();
});

// Cấu hình công suất máy (mới)
document.getElementById("addCapacityBtn").addEventListener("click", () => {
    const keyword = document.getElementById("newCapacityKeyword").value.trim();
    const capacity = parseInt(document.getElementById("newCapacityValue").value, 10);
    if (!keyword || isNaN(capacity) || capacity < 1) {
        alert("Vui lòng nhập từ khóa máy và công suất (>0).");
        return;
    }
    machineCapacityConfig.push({ keyword, capacity });
    saveMachineCapacityConfig();
    document.getElementById("newCapacityKeyword").value = "";
    document.getElementById("newCapacityValue").value = "";
});
document.getElementById("saveCapacityBtn").addEventListener("click", () => saveMachineCapacityConfig());
// Có thể thêm import cho công suất máy nếu muốn

// Cấu hình thời gian chuẩn
document.getElementById("importDurationBtn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx, .xls";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => { try { importDurationConfigFromExcel(evt.target.result); } catch (err) { alert("Lỗi import: " + err.message); } };
        reader.readAsArrayBuffer(file);
    };
    input.click();
});
document.getElementById("addDurationBtn").addEventListener("click", () => {
    const keyword = document.getElementById("newDurationKeyword").value.trim();
    const minutes = parseInt(document.getElementById("newDurationMinutes").value, 10);
    if (!keyword || isNaN(minutes) || minutes <= 0) { alert("Vui lòng nhập từ khóa và số phút hợp lệ (>0)."); return; }
    durationConfig.push({ keyword, minutes });
    saveDurationConfig();
    document.getElementById("newDurationKeyword").value = "";
    document.getElementById("newDurationMinutes").value = "";
});
document.getElementById("saveDurationConfigBtn").addEventListener("click", () => saveDurationConfig());

// Cấu hình trình tự
document.getElementById("importSequenceBtn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx, .xls";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => { try { importSequenceConfigFromExcel(evt.target.result); } catch (err) { alert("Lỗi import: " + err.message); } };
        reader.readAsArrayBuffer(file);
    };
    input.click();
});
document.getElementById("addSequenceBtn").addEventListener("click", () => {
    const name = document.getElementById("newSeqName").value.trim();
    const kw = document.getElementById("newSeqKw").value.trim();
    if (!name || !kw) { alert("Vui lòng nhập đầy đủ tên và từ khóa."); return; }
    sequenceConfig.push({ name, keywords: kw });
    saveSequenceConfig();
    document.getElementById("newSeqName").value = "";
    document.getElementById("newSeqKw").value = "";
});
document.getElementById("saveSequenceConfigBtn").addEventListener("click", () => saveSequenceConfig());

// Cấu hình diễn biến
document.getElementById("importEvolutionBtn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx, .xls";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => { try { importEvolutionConfigFromExcel(evt.target.result); } catch (err) { alert("Lỗi import: " + err.message); } };
        reader.readAsArrayBuffer(file);
    };
    input.click();
});
document.getElementById("addEvolutionBtn").addEventListener("click", () => {
    const disease = document.getElementById("newEvoDisease").value.trim();
    const kw = document.getElementById("newEvoKw").value.trim();
    if (!disease || !kw) { alert("Vui lòng nhập đầy đủ tên bệnh và từ khóa."); return; }
    evolutionConfig.push({ disease, keywords: kw });
    saveEvolutionConfig();
    document.getElementById("newEvoDisease").value = "";
    document.getElementById("newEvoKw").value = "";
});
document.getElementById("saveEvolutionConfigBtn").addEventListener("click", () => saveEvolutionConfig());

// Lưu tất cả
document.getElementById("saveAllConfigBtn").addEventListener("click", () => {
    saveMappingToStorage();
    saveThresholdConfig();
    saveMachineMappingConfig();
    saveMachineCapacityConfig();
    saveDurationConfig();
    saveSequenceConfig();
    saveEvolutionConfig();
    alert("Đã lưu tất cả cài đặt.");
});

// ========== MODAL XEM CHI TIẾT CELL ==========
const cellModal = document.getElementById("cellDetailModal");
const closeCellSpan = document.querySelector(".close-cell");
closeCellSpan.onclick = () => cellModal.style.display = "none";
window.onclick = (e) => { if (e.target == cellModal) cellModal.style.display = "none"; };

function attachDoubleClickToCells() {
    const cells = document.querySelectorAll("#dataTable td");
    cells.forEach(cell => {
        cell.ondblclick = function (e) {
            let fullText = this.getAttribute("data-fulltext");
            if (!fullText) fullText = this.innerText;
            const modal = document.getElementById("cellDetailModal");
            const contentDiv = document.getElementById("cellDetailContent");
            contentDiv.innerText = fullText;
            modal.style.display = "block";
        };
    });
}

// ========== KHỞI TẠO ==========
loadSequenceConfig();
loadEvolutionConfig();
loadMappingFromStorage();
loadThresholdConfig();
loadMachineMappingConfig();
loadMachineCapacityConfig();
loadDurationConfig();