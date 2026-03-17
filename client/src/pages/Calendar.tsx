// ---------------------------------------------------------------------------
// pages/Calendar.tsx -- Monthly review calendar showing due word counts
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCalendarCounts,
  getCalendarDayWords,
  type CalendarDayCount,
  type SavedWord,
} from '../api';
import { getDueStatus } from '../utils/srs';
import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons';

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toDateString(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function badgeClass(count: number): string {
  if (count <= 5) return 'calendar-badge green';
  if (count <= 20) return 'calendar-badge yellow';
  return 'calendar-badge red';
}

export default function Calendar() {
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [dayCounts, setDayCounts] = useState<CalendarDayCount[]>([]);
  const [newToday, setNewToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayWords, setDayWords] = useState<SavedWord[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const todayStr = toDateString(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const fetchMonth = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const data = await getCalendarCounts(y, m);
      setDayCounts(data.days);
      setNewToday(data.newToday);
    } catch (err) {
      console.error('Failed to fetch calendar:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonth(year, month);
    setSelectedDate(null);
    setDayWords([]);
  }, [year, month, fetchMonth]);

  const handlePrevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };

  const handleNextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  const handleDayClick = async (dateStr: string) => {
    if (selectedDate === dateStr) {
      setSelectedDate(null);
      setDayWords([]);
      return;
    }
    setSelectedDate(dateStr);
    setDayLoading(true);
    try {
      const words = await getCalendarDayWords(dateStr);
      setDayWords(words);
    } catch (err) {
      console.error('Failed to fetch day words:', err);
    } finally {
      setDayLoading(false);
    }
  };

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const countMap = new Map(dayCounts.map((d) => [d.date.slice(0, 10), d.count]));

  const cells: Array<{ day: number; dateStr: string; count: number } | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = toDateString(year, month, d);
    cells.push({ day: d, dateStr, count: countMap.get(dateStr) ?? 0 });
  }

  return (
    <div className="calendar-page">
      <div className="calendar-header">
        <button className="calendar-nav-btn" onClick={handlePrevMonth}>
          <ChevronLeftIcon size={20} />
        </button>
        <h2 className="calendar-title">{MONTH_NAMES[month - 1]} {year}</h2>
        <button className="calendar-nav-btn" onClick={handleNextMonth}>
          <ChevronRightIcon size={20} />
        </button>
      </div>

      {loading ? (
        <div className="calendar-loading"><div className="loading-spinner" /></div>
      ) : (
        <>
          <div className="calendar-grid">
            {DAY_NAMES.map((name) => (
              <div key={name} className="calendar-day-name">{name}</div>
            ))}
            {cells.map((cell, i) => {
              if (!cell) return <div key={`empty-${i}`} className="calendar-cell empty" />;
              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedDate;
              return (
                <button
                  key={cell.dateStr}
                  className={`calendar-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${cell.count > 0 ? ' has-reviews' : ''}`}
                  onClick={() => handleDayClick(cell.dateStr)}
                >
                  <span className="calendar-day-number">{cell.day}</span>
                  {cell.count > 0 && (
                    <span className={badgeClass(cell.count)}>{cell.count}</span>
                  )}
                  {isToday && newToday > 0 && (
                    <span className="calendar-badge new">{newToday} new</span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <div className="calendar-day-detail">
              <h3 className="calendar-day-detail-title">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                  weekday: 'long', month: 'long', day: 'numeric',
                })}
              </h3>
              {dayLoading ? (
                <div className="calendar-loading"><div className="loading-spinner" /></div>
              ) : dayWords.length === 0 ? (
                <p className="calendar-empty-day">No reviews due this day.</p>
              ) : (
                <div className="calendar-word-list">
                  {dayWords.map((word) => {
                    const status = getDueStatus(word);
                    return (
                      <div key={word.id} className="calendar-word-row">
                        <div className="calendar-word-info">
                          <span className="calendar-word-text">{word.word}</span>
                          <span className="calendar-word-translation">{word.translation}</span>
                        </div>
                        <div className="calendar-word-meta">
                          <span className={`calendar-word-status ${status.urgency}`}>{status.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <button className="btn btn-secondary calendar-back" onClick={() => navigate(-1)}>
        Back
      </button>
    </div>
  );
}
