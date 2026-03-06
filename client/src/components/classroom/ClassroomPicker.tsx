import React from 'react';
import type { Classroom } from '../../api';

interface Props {
  classrooms: Classroom[];
  value: string | null;
  onChange: (classroomId: string) => void;
  label?: string;
}

export default function ClassroomPicker({
  classrooms,
  value,
  onChange,
  label = 'Class',
}: Props) {
  if (classrooms.length === 0) return null;

  return (
    <label className="classroom-picker">
      <span className="classroom-picker-label">{label}</span>
      <select
        className="form-input classroom-picker-select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.name}
          </option>
        ))}
      </select>
    </label>
  );
}
