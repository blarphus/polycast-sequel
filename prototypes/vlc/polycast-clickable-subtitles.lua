-- PROTOTYPE ONLY: not loaded by any production Polycast target.
-- Polycast Clickable Subtitles for VLC
-- Loads a sidecar .srt file, shows the currently active subtitle line,
-- and opens Polycast dictionary lookup for clicked words.

local APP_URL = "https://polycast-sequel.onrender.com"
local MAX_WORD_BUTTONS = 24

local dlg = nil
local subtitle_path_input = nil
local cues = {}
local loaded_path = nil
local current_sentence = ""
local last_message = nil

function descriptor()
    return {
        title = "Polycast Clickable Subtitles",
        version = "0.1.0",
        author = "Polycast",
        shortdesc = "Click subtitle words into Polycast",
        description = "Loads sidecar SRT subtitles, renders the current words as buttons, and opens Polycast dictionary lookup for clicked words.",
        capabilities = { "input-listener" }
    }
end

function activate()
    create_dialog(nil)
end

function deactivate()
    if dlg ~= nil then
        pcall(function() dlg:delete() end)
        dlg = nil
    end
end

function close()
    vlc.deactivate()
end

function input_changed()
    cues = {}
    loaded_path = nil
    current_sentence = ""
    create_dialog("Input changed. Load subtitles again.")
end

function open_polycast()
    open_url(APP_URL .. "/dictionary")
end

function autodetect_subtitles()
    local path = guess_subtitle_path()
    if not path then
        create_dialog("No matching .srt found next to the current media file.")
        return
    end
    loaded_path = path
    load_subtitles(path, true)
end

function load_subtitles_from_input()
    local path = ""
    if subtitle_path_input ~= nil then
        path = trim(subtitle_path_input:get_text() or "")
    end

    if path == "" then
        path = guess_subtitle_path() or ""
    end

    if path == "" then
        create_dialog("Paste an .srt path or play a video with a matching sidecar subtitle.")
        return
    end

    load_subtitles(path, true)
end

function sync_now()
    if #cues == 0 then
        local path = ""
        if subtitle_path_input ~= nil then
            path = trim(subtitle_path_input:get_text() or "")
        end
        if path ~= "" and not load_subtitles(path, false) then
            return
        end
    end

    if #cues == 0 then
        create_dialog("No subtitles loaded yet.")
        return
    end

    local seconds = playback_seconds()
    if not seconds then
        create_dialog("No active VLC input. Start a video, then press Sync now.")
        return
    end

    local cue = find_cue(seconds)
    if cue then
        current_sentence = cue.text
        create_dialog("Time " .. format_time(seconds) .. " - " .. tostring(#cues) .. " subtitle cues loaded.")
    else
        current_sentence = ""
        create_dialog("Time " .. format_time(seconds) .. " - no subtitle cue at this moment.")
    end
end

function create_dialog(message)
    last_message = message
    if dlg ~= nil then
        pcall(function() dlg:delete() end)
        dlg = nil
    end

    dlg = vlc.dialog("Polycast Clickable Subtitles")

    dlg:add_label("Polycast Clickable Subtitles", 1, 1, 4, 1)
    dlg:add_button("Open Polycast", open_polycast, 5, 1, 2, 1)

    local initial_path = loaded_path or guess_subtitle_path() or ""
    dlg:add_label("Subtitle file", 1, 2, 1, 1)
    subtitle_path_input = dlg:add_text_input(initial_path, 2, 2, 5, 1)

    dlg:add_button("Auto-detect", autodetect_subtitles, 1, 3, 2, 1)
    dlg:add_button("Load .srt", load_subtitles_from_input, 3, 3, 2, 1)
    dlg:add_button("Sync now", sync_now, 5, 3, 2, 1)

    dlg:add_label(message or status_text(), 1, 4, 6, 1)

    local sentence = current_sentence
    if sentence == "" then
        sentence = "Load subtitles, play the video, then press Sync now."
    end
    dlg:add_label(sentence, 1, 5, 6, 2)

    render_word_buttons(7)
end

function render_word_buttons(start_row)
    local words = tokenize_words(current_sentence)
    if #words == 0 then
        return
    end

    local col = 1
    local row = start_row
    local shown = math.min(#words, MAX_WORD_BUTTONS)

    for i = 1, shown do
        local word = words[i]
        dlg:add_button(word, function() open_word(word) end, col, row, 1, 1)
        col = col + 1
        if col > 6 then
            col = 1
            row = row + 1
        end
    end

    if #words > MAX_WORD_BUTTONS then
        dlg:add_label("+" .. tostring(#words - MAX_WORD_BUTTONS) .. " more words", col, row, 2, 1)
    end
end

function open_word(word)
    local url = APP_URL ..
        "/dictionary?lookup=" .. url_encode(word) ..
        "&sentence=" .. url_encode(current_sentence) ..
        "&source=vlc"
    open_url(url)
end

function load_subtitles(path, should_sync)
    local parsed, err = parse_srt_file(path)
    if not parsed then
        create_dialog(err or "Could not load subtitles.")
        return false
    end

    cues = parsed
    loaded_path = path
    current_sentence = ""

    if should_sync then
        sync_now()
    else
        create_dialog("Loaded " .. tostring(#cues) .. " subtitle cues.")
    end
    return true
end

function parse_srt_file(path)
    local file = io.open(path, "r")
    if not file then
        return nil, "Could not open .srt file: " .. path
    end

    local content = file:read("*a") or ""
    file:close()
    content = content:gsub("\r\n", "\n"):gsub("\r", "\n")

    local parsed = {}
    local block = {}

    local function process_block(lines)
        if #lines < 2 then
            return
        end

        local time_index = 1
        if not lines[time_index]:find("%-%->") then
            time_index = 2
        end
        if not lines[time_index] then
            return
        end

        local starts, ends = lines[time_index]:match("(%d%d:%d%d:%d%d[%.,]%d%d%d)%s*%-%-%>%s*(%d%d:%d%d:%d%d[%.,]%d%d%d)")
        if not starts or not ends then
            return
        end

        local text_parts = {}
        for i = time_index + 1, #lines do
            table.insert(text_parts, strip_subtitle_markup(lines[i]))
        end

        local text = trim(table.concat(text_parts, " "):gsub("%s+", " "))
        if text ~= "" then
            table.insert(parsed, {
                starts = parse_timestamp(starts),
                ends = parse_timestamp(ends),
                text = text
            })
        end
    end

    for line in (content .. "\n"):gmatch("([^\n]*)\n") do
        if trim(line) == "" then
            process_block(block)
            block = {}
        else
            table.insert(block, line)
        end
    end

    if #parsed == 0 then
        return nil, "No SRT subtitle cues found in: " .. path
    end

    table.sort(parsed, function(a, b) return a.starts < b.starts end)
    return parsed, nil
end

function parse_timestamp(value)
    local hours, minutes, seconds, millis = value:match("(%d%d):(%d%d):(%d%d)[%.,](%d%d%d)")
    return (tonumber(hours) * 3600) + (tonumber(minutes) * 60) + tonumber(seconds) + (tonumber(millis) / 1000)
end

function find_cue(seconds)
    for _, cue in ipairs(cues) do
        if seconds >= cue.starts and seconds <= cue.ends then
            return cue
        end
        if cue.starts > seconds then
            return nil
        end
    end
    return nil
end

function playback_seconds()
    local input = vlc.object.input()
    if not input then
        return nil
    end

    local ok, value = pcall(function() return vlc.var.get(input, "time") end)
    if not ok or type(value) ~= "number" then
        return nil
    end

    if value > 100000 then
        return value / 1000000
    end
    return value
end

function guess_subtitle_path()
    local media_path = current_media_path()
    if not media_path then
        return nil
    end

    local base = media_path:gsub("%.[^%.%/]+$", "")
    local candidates = {
        base .. ".srt",
        base .. ".en.srt",
        base .. ".eng.srt",
        base .. ".pt.srt",
        base .. ".por.srt",
        base .. ".es.srt",
        base .. ".spa.srt",
        base .. ".fr.srt",
        base .. ".fra.srt"
    }

    for _, path in ipairs(candidates) do
        if file_exists(path) then
            return path
        end
    end

    return nil
end

function current_media_path()
    local item = vlc.input.item()
    if not item then
        return nil
    end

    local ok, uri = pcall(function() return item:uri() end)
    if not ok or type(uri) ~= "string" then
        return nil
    end

    if not uri:match("^file://") then
        return nil
    end

    local path = uri:gsub("^file://", "")
    return percent_decode(path)
end

function tokenize_words(text)
    local words = {}
    local seen = {}

    for raw in text:gmatch("[%w\192-\255][%w\192-\255'%-]*") do
        local word = trim(raw:gsub("^%-+", ""):gsub("%-+$", ""))
        if word ~= "" then
            local key = word:lower()
            if not seen[key] then
                table.insert(words, word)
                seen[key] = true
            end
        end
    end

    return words
end

function strip_subtitle_markup(text)
    return (text or "")
        :gsub("<[^>]*>", "")
        :gsub("{[^}]*}", "")
        :gsub("&nbsp;", " ")
        :gsub("&amp;", "&")
        :gsub("&lt;", "<")
        :gsub("&gt;", ">")
end

function status_text()
    if loaded_path then
        return "Loaded " .. tostring(#cues) .. " cues from " .. loaded_path
    end
    if last_message then
        return last_message
    end
    return "No subtitle file loaded."
end

function format_time(seconds)
    local total = math.floor(seconds or 0)
    local hours = math.floor(total / 3600)
    local minutes = math.floor((total % 3600) / 60)
    local secs = total % 60
    return string.format("%02d:%02d:%02d", hours, minutes, secs)
end

function open_url(url)
    local quoted = shell_quote(url)
    local opened = os.execute("open " .. quoted .. " >/dev/null 2>&1")
    if opened == true or opened == 0 then
        return
    end
    os.execute("xdg-open " .. quoted .. " >/dev/null 2>&1")
end

function url_encode(value)
    return tostring(value or "")
        :gsub("\n", " ")
        :gsub("([^%w%-%_%.%~])", function(char)
            return string.format("%%%02X", string.byte(char))
        end)
end

function percent_decode(value)
    return tostring(value or ""):gsub("%%(%x%x)", function(hex)
        return string.char(tonumber(hex, 16))
    end)
end

function shell_quote(value)
    return "'" .. tostring(value or ""):gsub("'", "'\\''") .. "'"
end

function file_exists(path)
    local file = io.open(path, "r")
    if file then
        file:close()
        return true
    end
    return false
end

function trim(value)
    return tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
end
