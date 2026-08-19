const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const {
    translateToArabic
} = require("./aiTranslator");


// ==================================================
// عدّل هذا فقط إذا تبغى تغير الـ PREFIX
// مثال:
// "admin.dashboard"
// "QWER"
// "users.profile"
// أو "" بدون Prefix
// ==================================================
const PREFIX = "admin.dashboard";



/**
 * Activate extension
 */
function activate(context) {
    const command = vscode.commands.registerCommand(
        "translationHelper.translateSelection",
        async function () {
            await translateSelection();
        }
    );

    const aiCommand = vscode.commands.registerCommand(
        "translationHelper.translateWithAI",
        async function () {
            await translateSelectionWithAI(context);
        }
    );

    const apiKeyCommand = vscode.commands.registerCommand(
        "translationHelper.setApiKey",
        async function () {
            await setOpenAIKey(context);
        }
    );

    context.subscriptions.push(
        command,
        aiCommand,
        apiKeyCommand
    );
}


/**
 * Main translation function
 */
async function translateSelection() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage("Translation Helper: No active editor.");
        return;
    }

    const document = editor.document;
    const selections = editor.selections;

    const selectedTexts = selections
        .map(selection => document.getText(selection))
        .filter(text => text.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage(
            "حدد كلمة أو جملة أولاً ثم اضغط Ctrl + Alt + X."
        );
        return;
    }

    const workspaceFolder =
        vscode.workspace.getWorkspaceFolder(document.uri);

    if (!workspaceFolder) {
        vscode.window.showErrorMessage(
            "افتح مشروعك داخل Workspace في VS Code أولاً."
        );
        return;
    }

    const config = vscode.workspace.getConfiguration("translationHelper");

    const englishFile = config.get(
        "englishFile",
        "locales/en.json"
    );

    const arabicFile = config.get(
        "arabicFile",
        "locales/ar.json"
    );

    const indent = config.get("indent", 2);

    const englishPath = resolveFilePath(
        workspaceFolder.uri.fsPath,
        englishFile
    );

    const arabicPath = resolveFilePath(
        workspaceFolder.uri.fsPath,
        arabicFile
    );

    if (!fs.existsSync(englishPath)) {
        vscode.window.showErrorMessage(
            `ملف اللغة الإنجليزية غير موجود:\n${englishFile}`
        );
        return;
    }

    if (!fs.existsSync(arabicPath)) {
        vscode.window.showErrorMessage(
            `ملف اللغة العربية غير موجود:\n${arabicFile}`
        );
        return;
    }

    let englishData;
    let arabicData;

    try {
        englishData = JSON.parse(
            fs.readFileSync(englishPath, "utf8")
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            "تعذر قراءة ملف en.json. تأكد أنه JSON صالح."
        );
        return;
    }

    try {
        arabicData = JSON.parse(
            fs.readFileSync(arabicPath, "utf8")
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            "تعذر قراءة ملف ar.json. تأكد أنه JSON صالح."
        );
        return;
    }

    const entries = [];

    for (const originalText of selectedTexts) {
        const key = createKey(originalText);

        entries.push({
            originalText,
            key
        });
    }

    const uniqueEntries = [];
    const seenKeys = new Set();

    for (const entry of entries) {
        if (!seenKeys.has(entry.key)) {
            seenKeys.add(entry.key);
            uniqueEntries.push(entry);
        }
    }

    const existingKeys = [];

    for (const entry of uniqueEntries) {
        const existsInEnglish = Object.prototype.hasOwnProperty.call(
            englishData,
            entry.key
        );

        const existsInArabic = Object.prototype.hasOwnProperty.call(
            arabicData,
            entry.key
        );

        if (existsInEnglish || existsInArabic) {
            existingKeys.push({
                key: entry.key,
                english: existsInEnglish,
                arabic: existsInArabic
            });
        }
    }

    if (existingKeys.length > 0) {
        const details = existingKeys
            .map(item => {
                let location = [];

                if (item.english) {
                    location.push("en.json");
                }

                if (item.arabic) {
                    location.push("ar.json");
                }

                return `${item.key} (${location.join(" + ")})`;
            })
            .join("\n");

        const result = await vscode.window.showWarningMessage(
            `المفتاح موجود مسبقاً:\n\n${details}\n\nلن يتم تكراره.`,
            "إلغاء",
            "استخدام الموجود"
        );

        if (result !== "استخدام الموجود") {
            return;
        }
    }

    for (const entry of uniqueEntries) {
        const existsInEnglish = Object.prototype.hasOwnProperty.call(
            englishData,
            entry.key
        );

        const existsInArabic = Object.prototype.hasOwnProperty.call(
            arabicData,
            entry.key
        );

        if (!existsInEnglish) {
            englishData[entry.key] = entry.originalText;
        }

        if (!existsInArabic) {
            arabicData[entry.key] = "";
        }
    }

    try {
        fs.writeFileSync(
            englishPath,
            JSON.stringify(englishData, null, indent) + "\n",
            "utf8"
        );

        fs.writeFileSync(
            arabicPath,
            JSON.stringify(arabicData, null, indent) + "\n",
            "utf8"
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `حدث خطأ أثناء حفظ ملفات الترجمة:\n${error.message}`
        );
        return;
    }

    const edit = new vscode.WorkspaceEdit();

    for (let i = 0; i < selections.length; i++) {
        const selection = selections[i];

        if (selection.isEmpty) {
            continue;
        }

        const originalText = document.getText(selection);

        const key = createKey(originalText);

        const replacement = `<%= __("` + key + `")%>`;

        edit.replace(
            document.uri,
            selection,
            replacement
        );
    }

    const applied = await vscode.workspace.applyEdit(edit);

    if (!applied) {
        vscode.window.showErrorMessage(
            "تعذر تعديل الملف الحالي."
        );
        return;
    }

    await document.save();

    const arabicDocument =
        await vscode.workspace.openTextDocument(arabicPath);

    const arabicEditor =
        await vscode.window.showTextDocument(
            arabicDocument,
            vscode.ViewColumn.Beside
        );

    let targetEntry = null;

    for (const entry of uniqueEntries) {
        const key = entry.key;

        if (
            Object.prototype.hasOwnProperty.call(
                arabicData,
                key
            )
        ) {
            if (arabicData[key] === "") {
                targetEntry = entry;
                break;
            }
        }
    }

    if (targetEntry) {
        const position =
            findJsonValuePosition(
                arabicDocument,
                targetEntry.key
            );

        if (position) {
            arabicEditor.selection =
                new vscode.Selection(
                    position,
                    position
                );

            arabicEditor.revealRange(
                new vscode.Range(
                    position,
                    position
                ),
                vscode.TextEditorRevealType.InCenter
            );
        }
    }

    vscode.window.showInformationMessage(
        `تمت إضافة ${uniqueEntries.length} ترجمة.`
    );
}


/**
 * Convert selected text into translation key.
 *
 * Spaces / tabs / new lines become underscores.
 * Prefix is automatically added.
 */
function createKey(text) {
    let key = text
        .trim()
        .replace(/\s+/g, "_");

    if (PREFIX && PREFIX.trim() !== "") {
        key = PREFIX.trim() + "." + key;
    }

    return key;
}


/**
 * Find the position where the Arabic JSON value starts.
 *
 * Example:
 * "hello": ""
 *
 * Returns the position between the two quotes:
 * "hello": |""
 */
function findJsonValuePosition(document, key) {
    const text = document.getText();

    const escapedKey = escapeRegExp(key);

    const regex = new RegExp(
        `"${escapedKey}"\\s*:\\s*""`
    );

    const match = regex.exec(text);

    if (!match) {
        return null;
    }

    const valueStart =
        match.index +
        match[0].lastIndexOf('""') +
        1;

    return document.positionAt(valueStart);
}


/**
 * Escape text for RegExp
 */
function escapeRegExp(text) {
    return text.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}


function resolveFilePath(workspacePath, filePath) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    return path.join(workspacePath, filePath);
}


async function setOpenAIKey(context) {
    const apiKey = await vscode.window.showInputBox({
        prompt: "أدخل OpenAI API Key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "sk-..."
    });

    if (!apiKey) {
        return;
    }

    await context.secrets.store(
        "translationHelper.openaiApiKey",
        apiKey.trim()
    );

    vscode.window.showInformationMessage(
        "تم حفظ OpenAI API Key بشكل آمن في VS Code."
    );
}


async function translateSelectionWithAI(context) {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage(
            "Translation Helper: No active editor."
        );
        return;
    }

    const document = editor.document;

    const selectedTexts = editor.selections
        .map(selection => document.getText(selection))
        .filter(text => text.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage(
            "حدد كلمة أو جملة أولاً."
        );
        return;
    }

    const apiKey = await context.secrets.get(
        "translationHelper.openaiApiKey"
    );

    if (!apiKey) {
        const result = await vscode.window.showWarningMessage(
            "ما فيه OpenAI API Key محفوظ.",
            "إضافة المفتاح"
        );

        if (result === "إضافة المفتاح") {
            await setOpenAIKey(context);
        }

        return;
    }

    const workspaceFolder =
        vscode.workspace.getWorkspaceFolder(document.uri);

    if (!workspaceFolder) {
        vscode.window.showErrorMessage(
            "افتح مشروعك داخل Workspace."
        );
        return;
    }

    const config =
        vscode.workspace.getConfiguration("translationHelper");

    const englishFile =
        config.get(
            "englishFile",
            "locales/en.json"
        );

    const arabicFile =
        config.get(
            "arabicFile",
            "locales/ar.json"
        );

    const indent =
        config.get("indent", 2);

    const englishPath =
        resolveFilePath(
            workspaceFolder.uri.fsPath,
            englishFile
        );

    const arabicPath =
        resolveFilePath(
            workspaceFolder.uri.fsPath,
            arabicFile
        );

    if (!fs.existsSync(englishPath)) {
        vscode.window.showErrorMessage(
            `ملف اللغة الإنجليزية غير موجود:\n${englishPath}`
        );
        return;
    }

    if (!fs.existsSync(arabicPath)) {
        vscode.window.showErrorMessage(
            `ملف اللغة العربية غير موجود:\n${arabicPath}`
        );
        return;
    }

    let englishData;
    let arabicData;

    try {
        englishData = JSON.parse(
            fs.readFileSync(
                englishPath,
                "utf8"
            )
        );

        arabicData = JSON.parse(
            fs.readFileSync(
                arabicPath,
                "utf8"
            )
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `تعذر قراءة ملفات الترجمة:\n${error.message}`
        );
        return;
    }

    const entries = [];

    for (const originalText of selectedTexts) {
        const key =
            createKey(originalText);

        entries.push({
            originalText,
            key
        });
    }

    const uniqueEntries = [];
    const seenKeys = new Set();

    for (const entry of entries) {
        if (!seenKeys.has(entry.key)) {
            seenKeys.add(entry.key);
            uniqueEntries.push(entry);
        }
    }

    const existingKeys = [];

    for (const entry of uniqueEntries) {
        const existsInEnglish =
            Object.prototype.hasOwnProperty.call(
                englishData,
                entry.key
            );

        const existsInArabic =
            Object.prototype.hasOwnProperty.call(
                arabicData,
                entry.key
            );

        if (
            existsInEnglish ||
            existsInArabic
        ) {
            existingKeys.push({
                key: entry.key,
                english: existsInEnglish,
                arabic: existsInArabic
            });
        }
    }

    if (existingKeys.length > 0) {
        const details =
            existingKeys
                .map(item => {
                    const locations = [];

                    if (item.english) {
                        locations.push("en.json");
                    }

                    if (item.arabic) {
                        locations.push("ar.json");
                    }

                    return `${item.key} (${locations.join(" + ")})`;
                })
                .join("\n");

        const result =
            await vscode.window.showWarningMessage(
                `المفتاح موجود مسبقاً:\n\n${details}\n\nلن يتم تكراره.`,
                "إلغاء",
                "استخدام الموجود"
            );

        if (result !== "استخدام الموجود") {
            return;
        }
    }

    await vscode.window.withProgress(
        {
            location:
                vscode.ProgressLocation.Notification,
            title:
                "Translation Helper: جاري الترجمة بالذكاء الاصطناعي...",
            cancellable: false
        },
        async () => {
            for (const entry of uniqueEntries) {
                const existsInEnglish =
                    Object.prototype.hasOwnProperty.call(
                        englishData,
                        entry.key
                    );

                const existsInArabic =
                    Object.prototype.hasOwnProperty.call(
                        arabicData,
                        entry.key
                    );

                if (!existsInEnglish) {
                    englishData[entry.key] =
                        entry.originalText;
                }

                if (!existsInArabic) {
                    const arabicTranslation =
                        await translateToArabic(
                            apiKey,
                            entry.originalText
                        );

                    arabicData[entry.key] =
                        arabicTranslation;
                }
            }
        }
    );

    try {
        fs.writeFileSync(
            englishPath,
            JSON.stringify(
                englishData,
                null,
                indent
            ) + "\n",
            "utf8"
        );

        fs.writeFileSync(
            arabicPath,
            JSON.stringify(
                arabicData,
                null,
                indent
            ) + "\n",
            "utf8"
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `حدث خطأ أثناء حفظ ملفات الترجمة:\n${error.message}`
        );
        return;
    }

    const edit =
        new vscode.WorkspaceEdit();

    for (const selection of editor.selections) {
        if (selection.isEmpty) {
            continue;
        }

        const originalText =
            document.getText(selection);

        const key =
            createKey(originalText);

        const replacement =
            `<%= __("` +
            key +
            `")%>`;

        edit.replace(
            document.uri,
            selection,
            replacement
        );
    }

    const applied =
        await vscode.workspace.applyEdit(
            edit
        );

    if (!applied) {
        vscode.window.showErrorMessage(
            "تعذر تعديل الملف الحالي."
        );
        return;
    }

    await document.save();

    const arabicDocument =
        await vscode.workspace.openTextDocument(
            arabicPath
        );

    const arabicEditor =
        await vscode.window.showTextDocument(
            arabicDocument,
            vscode.ViewColumn.Beside
        );

    const firstEntry =
        uniqueEntries[0];

    if (firstEntry) {
        const position =
            findJsonValuePosition(
                arabicDocument,
                firstEntry.key
            );

        if (position) {
            arabicEditor.selection =
                new vscode.Selection(
                    position,
                    position
                );

            arabicEditor.revealRange(
                new vscode.Range(
                    position,
                    position
                ),
                vscode.TextEditorRevealType.InCenter
            );
        }
    }

    vscode.window.showInformationMessage(
        `تمت ترجمة ${uniqueEntries.length} نص بالذكاء الاصطناعي. راجع الترجمة قبل اعتمادها.`
    );
}


function deactivate() {}

module.exports = {
    activate,
    deactivate
};

