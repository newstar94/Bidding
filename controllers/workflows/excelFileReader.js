export function readExcelRows(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const workbook = XLSX.read(evt.target.result, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                resolve(XLSX.utils.sheet_to_json(sheet));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsBinaryString(file);
    });
}

export function showExcelImportSaveButton() {
    const saveBtn = document.getElementById('btn-save-excel-import');
    if (!saveBtn) return;
    saveBtn.disabled = false;
    saveBtn.style.display = 'inline-flex';
}
