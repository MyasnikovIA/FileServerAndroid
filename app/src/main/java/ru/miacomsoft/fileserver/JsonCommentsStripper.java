package ru.miacomsoft.fileserver;

import java.util.Objects;

/**
 * Утилита для удаления комментариев из текста JSON-файла
 * ДО передачи этого текста стандартному парсеру (org.json).
 *
 * Поддерживаются три вида комментариев:
 *
 *   1) Однострочные с "//":
 *          "port": 8080   // основной порт
 *
 *   2) Однострочные с "#":
 *          "web": "www"   # каталог статики
 *
 *   3) Многострочные с "/* ... *\/":
 *          /*
 *           * Настройки сервера
 *           *\/
 *          "host": "0.0.0.0"
 *
 * ВАЖНО:
 *   • Внутри строковых литералов (в двойных кавычках) комментарии
 *     НЕ распознаются. Это значит, что строка
 *          "url": "http://example.com/#section"
 *     останется нетронутой, несмотря на "//" и "#" внутри неё.
 *   • Экранированные кавычки внутри строк ("\"" ) обрабатываются корректно.
 *   • Символы комментариев заменяются ПРОБЕЛАМИ, а переводы строк (\n, \r)
 *     сохраняются как есть. Это нужно, чтобы:
 *         – не сбить номер строки при ошибке парсинга;
 *         – сохранить структуру текста для отладки.
 *
 * Использование:
 *
 *      String raw  = new String(Files.readAllBytes(configPath), StandardCharsets.UTF_8);
 *      String json = JsonCommentsStripper.strip(raw);
 *      JSONObject root = new JSONObject(json);
 */
public final class JsonCommentsStripper {

    private JsonCommentsStripper() {
        // утилитный класс
    }

    /**
     * Удаляет комментарии (//, #, /* *\/) из текста, сохраняя
     * содержимое строковых литералов и переводы строк.
     *
     * @param input исходный текст файла (не null)
     * @return текст без комментариев
     * @throws IllegalArgumentException если блок /* … *\/ не закрыт
     */
    public static String strip(String input) {
        Objects.requireNonNull(input, "input");

        int n = input.length();
        if (n == 0) return input;

        StringBuilder out = new StringBuilder(n);

        boolean inString = false;    // внутри "..."
        boolean escaping = false;    // предыдущий символ в строке был '\'

        int i = 0;
        while (i < n) {
            char c = input.charAt(i);

            // ----------------------------------------------------
            // 1. Внутри строкового литерала
            // ----------------------------------------------------
            if (inString) {
                out.append(c);

                if (escaping) {
                    // Это был экранированный символ (\" или \\ и т.п.)
                    escaping = false;
                } else if (c == '\\') {
                    escaping = true;
                } else if (c == '"') {
                    inString = false;
                }

                i++;
                continue;
            }

            // ----------------------------------------------------
            // 2. Открывающая кавычка — входим в строку
            // ----------------------------------------------------
            if (c == '"') {
                inString = true;
                out.append(c);
                i++;
                continue;
            }

            // ----------------------------------------------------
            // 3. Однострочный комментарий "//"
            // ----------------------------------------------------
            if (c == '/' && i + 1 < n && input.charAt(i + 1) == '/') {
                while (i < n && input.charAt(i) != '\n' && input.charAt(i) != '\r') {
                    out.append(' ');
                    i++;
                }
                // \n или \r оставляем нетронутым — увидит следующая итерация
                continue;
            }

            // ----------------------------------------------------
            // 4. Многострочный комментарий "/* … */"
            // ----------------------------------------------------
            if (c == '/' && i + 1 < n && input.charAt(i + 1) == '*') {
                out.append(' ').append(' ');
                i += 2;

                boolean closed = false;
                while (i < n) {
                    if (input.charAt(i) == '*' && i + 1 < n && input.charAt(i + 1) == '/') {
                        out.append(' ').append(' ');
                        i += 2;
                        closed = true;
                        break;
                    }
                    char cc = input.charAt(i);
                    if (cc == '\n' || cc == '\r') {
                        // Сохраняем структуру строк
                        out.append(cc);
                    } else {
                        out.append(' ');
                    }
                    i++;
                }

                if (!closed) {
                    throw new IllegalArgumentException(
                            "Unterminated block comment: /* … */ (забыт закрывающий */)"
                    );
                }
                continue;
            }

            // ----------------------------------------------------
            // 5. Однострочный комментарий "#"
            // ----------------------------------------------------
            // Вне строк символ '#' не является валидной частью JSON,
            // поэтому однозначно трактуем его как начало комментария.
            if (c == '#') {
                while (i < n && input.charAt(i) != '\n' && input.charAt(i) != '\r') {
                    out.append(' ');
                    i++;
                }
                continue;
            }

            // ----------------------------------------------------
            // 6. Обычный символ
            // ----------------------------------------------------
            out.append(c);
            i++;
        }

        return out.toString();
    }
}