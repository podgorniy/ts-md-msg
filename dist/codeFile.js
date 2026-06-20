const defaultLanguageToExt = {
    python: 'py',
    javascript: 'js',
    typescript: 'ts',
    java: 'java',
    'c++': 'cpp',
    c: 'c',
    html: 'html',
    css: 'css',
    bash: 'sh',
    shell: 'sh',
    php: 'php',
    markdown: 'md',
    dotenv: 'env',
    json: 'json',
    yaml: 'yaml',
    xml: 'xml',
    dockerfile: 'dockerfile',
    plaintext: 'txt',
    toml: 'toml',
    go: 'go',
    ruby: 'rb',
    rust: 'rs',
    perl: 'pl',
    swift: 'swift',
    kotlin: 'kt',
    sql: 'sql',
    jsx: 'jsx',
    tsx: 'tsx',
    graphql: 'graphql',
    r: 'r',
    dart: 'dart',
    scala: 'scala',
    groovy: 'groovy',
};
function extractValidFilename(line) {
    const pattern = /([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+)/g;
    const matches = line.match(pattern);
    if (matches) {
        for (const match of matches) {
            if (match.includes('.')) {
                const ext = match.split('.').pop();
                if (ext)
                    return match;
            }
        }
    }
    return null;
}
function getExt(language, langMap = defaultLanguageToExt) {
    return langMap[language.toLowerCase()] || 'txt';
}
export function getFilename(code, language, langMap = defaultLanguageToExt) {
    const sample = code.split('\n').slice(0, 2).join('').replace(/\\/g, '');
    let aFilename = null;
    let bExt = 'txt';
    try {
        aFilename = extractValidFilename(sample);
        bExt = getExt(language, langMap);
    }
    catch (exc) {
        console.error(`Error occurred: ${exc}`);
        aFilename = null;
        bExt = 'txt';
    }
    if (aFilename) {
        if (aFilename.endsWith(`.${bExt}`) && aFilename.length <= 24) {
            return aFilename;
        }
        else {
            return `${aFilename}.${bExt}`;
        }
    }
    return `readable.${bExt}`;
}
