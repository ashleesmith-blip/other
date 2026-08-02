import React, { useState, useEffect } from 'react';

const getStorage = () => {
  if (typeof window !== 'undefined' && window.storage) {
    return window.storage;
  }
  return localStorage;
};

const Athletics = () => {
  const storage = getStorage();

  // Default houses
  const DEFAULT_HOUSES = [
    { id: 1, name: 'Freeman', colour: '#FF6B6B' },
    { id: 2, name: 'Goldstein', colour: '#4ECDC4' },
    { id: 3, name: 'Flinders', colour: '#FFE66D' },
    { id: 4, name: 'Mabo', colour: '#95E1D3' }
  ];

  // State
  const [currentTab, setCurrentTab] = useState('events');
  const [userRole, setUserRole] = useState(null);
  const [schoolName, setSchoolName] = useState('');
  const [importPreview, setImportPreview] = useState(null);

  // Data states
  const [houses, setHouses] = useState(() => {
    const stored = JSON.parse(storage.getItem('athleticsHouses'));
    if (stored && stored.length > 0) return stored;
    storage.setItem('athleticsHouses', JSON.stringify(DEFAULT_HOUSES));
    return DEFAULT_HOUSES;
  });
  const [events, setEvents] = useState(() => JSON.parse(storage.getItem('athleticsEvents')) || []);
  const [students, setStudents] = useState(() => JSON.parse(storage.getItem('athleticsStudents')) || []);
  const [records, setRecords] = useState(() => JSON.parse(storage.getItem('athleticsRecords')) || []);
  const [districtQualifiers, setDistrictQualifiers] = useState(() => JSON.parse(storage.getItem('athleticsDistrictQualifiers')) || []);
  const [videos, setVideos] = useState(() => JSON.parse(storage.getItem('athleticsVideos')) || []);
  const [assessments, setAssessments] = useState(() => JSON.parse(storage.getItem('athleticsAssessments')) || []);
  const [interschool, setInterschool] = useState(() => JSON.parse(storage.getItem('athleticsInterschool')) || []);

  // Save to storage
  useEffect(() => { storage.setItem('athleticsHouses', JSON.stringify(houses)); }, [houses, storage]);
  useEffect(() => { storage.setItem('athleticsEvents', JSON.stringify(events)); }, [events, storage]);
  useEffect(() => { storage.setItem('athleticsStudents', JSON.stringify(students)); }, [students, storage]);
  useEffect(() => { storage.setItem('athleticsRecords', JSON.stringify(records)); }, [records, storage]);
  useEffect(() => { storage.setItem('athleticsDistrictQualifiers', JSON.stringify(districtQualifiers)); }, [districtQualifiers, storage]);
  useEffect(() => { storage.setItem('athleticsVideos', JSON.stringify(videos)); }, [videos, storage]);
  useEffect(() => { storage.setItem('athleticsAssessments', JSON.stringify(assessments)); }, [assessments, storage]);
  useEffect(() => { storage.setItem('athleticsInterschool', JSON.stringify(interschool)); }, [interschool, storage]);

  // Login screen
  if (!userRole) {
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', fontFamily: 'system-ui' }}>
        <h1>Athletics Manager</h1>
        <p>Select your role:</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => { setUserRole('admin'); setSchoolName('Your School'); }} style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
            Admin
          </button>
          <button onClick={() => setUserRole('teacher')} style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
            Teacher
          </button>
          <button onClick={() => setUserRole('student')} style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
            Student
          </button>
        </div>
      </div>
    );
  }

  // ADMIN TABS
  const AdminEventsTab = () => {
    const [newEvent, setNewEvent] = useState({ name: '', type: '', distance: '', record: '', recordHolder: '', unit: 'm' });

    const addEvent = () => {
      if (newEvent.name && newEvent.type) {
        setEvents([...events, { id: Date.now(), ...newEvent }]);
        setNewEvent({ name: '', type: '', distance: '', record: '', recordHolder: '', unit: 'm' });
      }
    };

    return (
      <div>
        <h2>Athletics Events</h2>
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Add Event</h3>
          <input
            type="text"
            placeholder="Event name (e.g., 100m Sprint)"
            value={newEvent.name}
            onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <select
            value={newEvent.type}
            onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Select type</option>
            <option value="sprint">Sprint</option>
            <option value="distance">Distance</option>
            <option value="field">Field Event</option>
            <option value="relay">Relay</option>
          </select>
          <input
            type="text"
            placeholder="Current record"
            value={newEvent.record}
            onChange={(e) => setNewEvent({ ...newEvent, record: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <input
            type="text"
            placeholder="Record holder name"
            value={newEvent.recordHolder}
            onChange={(e) => setNewEvent({ ...newEvent, recordHolder: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <select
            value={newEvent.unit}
            onChange={(e) => setNewEvent({ ...newEvent, unit: e.target.value })}
            style={{ display: 'inline-block', marginRight: '8px', padding: '8px' }}
          >
            <option value="sec">Seconds</option>
            <option value="m">Metres</option>
            <option value="cm">Centimetres</option>
          </select>
          <button onClick={addEvent} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add Event
          </button>
        </div>
        <div>
          {events.length === 0 ? (
            <p>No events yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#e0e0e0' }}>
                  <th style={{ border: '1px solid #ccc', padding: '8px' }}>Event</th>
                  <th style={{ border: '1px solid #ccc', padding: '8px' }}>Type</th>
                  <th style={{ border: '1px solid #ccc', padding: '8px' }}>Record</th>
                  <th style={{ border: '1px solid #ccc', padding: '8px' }}>Record Holder</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ border: '1px solid #ccc', padding: '8px' }}>{e.name}</td>
                    <td style={{ border: '1px solid #ccc', padding: '8px' }}>{e.type}</td>
                    <td style={{ border: '1px solid #ccc', padding: '8px' }}>{e.record} {e.unit}</td>
                    <td style={{ border: '1px solid #ccc', padding: '8px' }}>{e.recordHolder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const AdminHousesTab = () => {
    const [newHouse, setNewHouse] = useState({ name: '', colour: '#FF6B6B' });

    const addHouse = () => {
      if (newHouse.name) {
        setHouses([...houses, { id: Date.now(), ...newHouse }]);
        setNewHouse({ name: '', colour: '#FF6B6B' });
      }
    };

    return (
      <div>
        <h2>Houses</h2>
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Add House</h3>
          <input
            type="text"
            placeholder="House name"
            value={newHouse.name}
            onChange={(e) => setNewHouse({ ...newHouse, name: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <label style={{ display: 'block', marginBottom: '8px' }}>
            House colour:
            <input
              type="color"
              value={newHouse.colour}
              onChange={(e) => setNewHouse({ ...newHouse, colour: e.target.value })}
              style={{ marginLeft: '8px', cursor: 'pointer' }}
            />
          </label>
          <button onClick={addHouse} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add House
          </button>
        </div>
        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
          {houses.map((h) => (
            <div key={h.id} style={{ padding: '15px', backgroundColor: h.colour, color: 'white', borderRadius: '8px', minWidth: '150px' }}>
              <strong>{h.name}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const AdminStudentsTab = () => {
    const [newStudent, setNewStudent] = useState({ name: '', yearLevel: '', house: '', beepTestResult: '' });

    const addStudent = () => {
      if (newStudent.name && newStudent.house) {
        setStudents([...students, { id: Date.now(), ...newStudent }]);
        setNewStudent({ name: '', yearLevel: '', house: '', beepTestResult: '' });
      }
    };

    return (
      <div>
        <h2>Students</h2>
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Add Student</h3>
          <input
            type="text"
            placeholder="Student name"
            value={newStudent.name}
            onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <select
            value={newStudent.yearLevel}
            onChange={(e) => setNewStudent({ ...newStudent, yearLevel: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Select year level</option>
            {['Prep', '1', '2', '3', '4', '5', '6'].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={newStudent.house}
            onChange={(e) => setNewStudent({ ...newStudent, house: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Select house</option>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <input
            type="text"
            placeholder="Beep test result (e.g., Level 5, Shuttle 6)"
            value={newStudent.beepTestResult}
            onChange={(e) => setNewStudent({ ...newStudent, beepTestResult: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <button onClick={addStudent} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add Student
          </button>
        </div>
        {students.length === 0 ? (
          <p>No students yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#e0e0e0' }}>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Name</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Year</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>House</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Beep Test</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{s.name}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{s.yearLevel}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{houses.find(h => h.id == s.house)?.name || 'N/A'}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{s.beepTestResult}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const AdminRecordsTab = () => {
    const [selectedEvent, setSelectedEvent] = useState('');
    const [newRecord, setNewRecord] = useState({ studentId: '', time: '', date: '' });

    const addRecord = () => {
      if (selectedEvent && newRecord.studentId && newRecord.time) {
        setRecords([...records, { id: Date.now(), eventId: selectedEvent, ...newRecord }]);
        setNewRecord({ studentId: '', time: '', date: '' });
      }
    };

    return (
      <div>
        <h2>Records & Times</h2>
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Add Record</h3>
          <select
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Select event</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select
            value={newRecord.studentId}
            onChange={(e) => setNewRecord({ ...newRecord, studentId: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Select student</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input
            type="text"
            placeholder="Time/Distance (e.g., 12.5s or 2.50m)"
            value={newRecord.time}
            onChange={(e) => setNewRecord({ ...newRecord, time: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <input
            type="date"
            value={newRecord.date}
            onChange={(e) => setNewRecord({ ...newRecord, date: e.target.value })}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
          <button onClick={addRecord} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add Record
          </button>
        </div>
        {records.length === 0 ? (
          <p>No records yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#e0e0e0' }}>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Event</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Student</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Result</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{events.find(e => e.id == r.eventId)?.name || 'Unknown'}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{students.find(s => s.id == r.studentId)?.name || 'Unknown'}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{r.time}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const AdminDistrictTab = () => {
    const [selectedStudent, setSelectedStudent] = useState('');
    const [selectedEvents, setSelectedEvents] = useState([]);

    const markQualifier = () => {
      if (selectedStudent && selectedEvents.length > 0) {
        const existing = districtQualifiers.findIndex(q => q.studentId === selectedStudent);
        if (existing >= 0) {
          const updated = [...districtQualifiers];
          updated[existing] = { ...updated[existing], qualifiedEvents: selectedEvents };
          setDistrictQualifiers(updated);
        } else {
          setDistrictQualifiers([...districtQualifiers, { id: Date.now(), studentId: selectedStudent, qualifiedEvents: selectedEvents, preferences: [] }]);
        }
        setSelectedStudent('');
        setSelectedEvents([]);
      }
    };

    return (
      <div>
        <h2>District Qualifiers</h2>
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Mark District Qualifiers</h3>
          <select
            value={selectedStudent}
            onChange={(e) => setSelectedStudent(e.target.value)}
            style={{ display: 'block', marginBottom: '8px', padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Select student</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div style={{ marginBottom: '8px' }}>
            <p>Qualified events:</p>
            {events.map((e) => (
              <label key={e.id} style={{ display: 'block', marginBottom: '4px' }}>
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(e.id)}
                  onChange={(ev) => {
                    if (ev.target.checked) {
                      setSelectedEvents([...selectedEvents, e.id]);
                    } else {
                      setSelectedEvents(selectedEvents.filter(id => id !== e.id));
                    }
                  }}
                />
                {e.name}
              </label>
            ))}
          </div>
          <button onClick={markQualifier} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Mark Qualifications
          </button>
        </div>
        <div>
          <h3>Qualifiers Summary</h3>
          {districtQualifiers.length === 0 ? (
            <p>No qualifiers yet.</p>
          ) : (
            <div>
              {districtQualifiers.map((q) => (
                <div key={q.id} style={{ padding: '12px', marginBottom: '8px', backgroundColor: '#e8f5e9', borderRadius: '4px' }}>
                  <strong>{students.find(s => s.id == q.studentId)?.name}</strong> — {q.qualifiedEvents.length} events
                  <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                    {q.qualifiedEvents.map(eid => events.find(e => e.id == eid)?.name).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const AdminImportTab = () => {
    const [pastedData, setPastedData] = useState('');

    const parseStudentData = (jsonString) => {
      try {
        const data = JSON.parse(jsonString);
        if (!Array.isArray(data)) throw new Error('Data must be an array');
        return data.filter(s => s.name && s.house);
      } catch (e) {
        alert('Invalid JSON format: ' + e.message);
        return [];
      }
    };

    const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          if (Array.isArray(data) && data.length > 0) {
            setImportPreview(data);
          } else {
            alert('File must contain an array of students');
          }
        } catch (err) {
          alert('Invalid file format: ' + err.message);
        }
      };
      reader.readAsText(file);
    };

    const handlePasteData = () => {
      if (!pastedData.trim()) {
        alert('Please paste student data');
        return;
      }
      const parsed = parseStudentData(pastedData);
      if (parsed.length > 0) {
        setImportPreview(parsed);
        setPastedData('');
      }
    };

    const confirmImport = () => {
      if (!importPreview || importPreview.length === 0) return;

      const newStudents = importPreview.map((s, idx) => ({
        id: Date.now() + idx,
        name: s.name,
        yearLevel: s.yearLevel || s.year || '',
        house: s.house || s.houseId || '',
        beepTestResult: s.beepTestResult || ''
      })).filter(s => s.name && s.house);

      setStudents([...students, ...newStudents]);
      setImportPreview(null);
      alert(`✓ Imported ${newStudents.length} students`);
    };

    if (importPreview && importPreview.length > 0) {
      return (
        <div>
          <h2>Import Preview</h2>
          <div style={{ padding: '15px', backgroundColor: '#e8f5e9', borderRadius: '8px', marginBottom: '15px' }}>
            <p><strong>Ready to import {importPreview.length} students:</strong></p>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '15px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ backgroundColor: '#c8e6c9' }}>
                    <th style={{ border: '1px solid #ccc', padding: '8px' }}>Name</th>
                    <th style={{ border: '1px solid #ccc', padding: '8px' }}>Year</th>
                    <th style={{ border: '1px solid #ccc', padding: '8px' }}>House</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 20).map((s, idx) => (
                    <tr key={idx}>
                      <td style={{ border: '1px solid #ccc', padding: '8px' }}>{s.name}</td>
                      <td style={{ border: '1px solid #ccc', padding: '8px' }}>{s.year || s.yearLevel || '-'}</td>
                      <td style={{ border: '1px solid #ccc', padding: '8px' }}>{s.house}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 20 && <p style={{ fontSize: '0.9em', marginTop: '8px' }}>... and {importPreview.length - 20} more</p>}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={confirmImport} style={{ padding: '10px 20px', backgroundColor: '#4CAF50', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>
                ✓ Confirm Import
              </button>
              <button onClick={() => setImportPreview(null)} style={{ padding: '10px 20px', backgroundColor: '#f44336', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div>
        <h2>Import Students</h2>

        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Upload JSON File</h3>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            style={{ display: 'block', marginBottom: '8px' }}
          />
          <p style={{ fontSize: '0.9em', color: '#666' }}>File format: JSON array of students with name, year, house, beepTestResult</p>
        </div>

        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Paste JSON Data</h3>
          <textarea
            placeholder='Paste JSON data:\n[{"name": "John Doe", "year": "5", "house": "Freeman", "beepTestResult": "Level 6"}]'
            value={pastedData}
            onChange={(e) => setPastedData(e.target.value)}
            style={{ width: '100%', height: '150px', padding: '8px', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '12px' }}
          />
          <button onClick={handlePasteData} style={{ padding: '8px 16px', cursor: 'pointer', marginTop: '8px' }}>
            Import from Paste
          </button>
        </div>

        <div style={{ padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px' }}>
          <h3>Current Student Count: {students.length}</h3>
          {students.length === 0 && (
            <p>Import student data to get started. Each student needs: name, year level, and house.</p>
          )}
        </div>
      </div>
    );
  };

  // STUDENT TABS
  const StudentProfileTab = () => {
    const currentStudent = students.find(s => s.id == userRole);

    if (!currentStudent) {
      return <p>Student not found.</p>;
    }

    const studentRecords = records.filter(r => r.studentId === currentStudent.id);
    const studentQualifier = districtQualifiers.find(q => q.studentId === currentStudent.id);

    return (
      <div>
        <h2>{currentStudent.name}</h2>
        <div style={{ marginBottom: '15px', padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px' }}>
          <p><strong>Year Level:</strong> {currentStudent.yearLevel}</p>
          <p><strong>House:</strong> {houses.find(h => h.id == currentStudent.house)?.name}</p>
          <p><strong>Beep Test:</strong> {currentStudent.beepTestResult}</p>
        </div>
        <h3>Personal Records</h3>
        {studentRecords.length === 0 ? (
          <p>No records yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#e0e0e0' }}>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Event</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Result</th>
                <th style={{ border: '1px solid #ccc', padding: '8px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {studentRecords.map((r) => (
                <tr key={r.id}>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{events.find(e => e.id == r.eventId)?.name}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{r.time}</td>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {studentQualifier && (
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3e0', borderRadius: '8px' }}>
            <h3>🏅 District Qualifications</h3>
            <p>You have qualified for {studentQualifier.qualifiedEvents.length} events:</p>
            <ul>
              {studentQualifier.qualifiedEvents.map(eid => (
                <li key={eid}>{events.find(e => e.id == eid)?.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const StudentPreferencesTab = () => {
    const currentStudent = students.find(s => s.id == userRole);
    const studentQualifier = districtQualifiers.find(q => q.studentId === currentStudent.id);

    if (!studentQualifier) {
      return <p>You have not qualified for any district events yet.</p>;
    }

    const [preferences, setPreferences] = useState(() => studentQualifier.preferences || []);
    const [relay, setRelay] = useState(() => studentQualifier.relayChoice || '');

    const savePreferences = () => {
      if (preferences.length !== 2) {
        alert('You must select exactly 2 events.');
        return;
      }
      if (!relay) {
        alert('You must select a relay.');
        return;
      }
      const updated = districtQualifiers.map(q =>
        q.id === studentQualifier.id
          ? { ...q, preferences, relayChoice: relay, preferencesSubmitted: true }
          : q
      );
      setDistrictQualifiers(updated);
      alert('Your preferences have been submitted!');
    };

    const qualifiedEventIds = studentQualifier.qualifiedEvents;
    const relayEvents = events.filter(e => e.type === 'relay').map(e => e.id);

    return (
      <div>
        <h2>District Event Preferences</h2>
        <p>You qualified for {qualifiedEventIds.length} events. Please select 2 to compete in, plus a relay.</p>

        <div style={{ marginBottom: '15px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Select 2 Events</h3>
          {qualifiedEventIds.map(eid => {
            const event = events.find(e => e.id === eid);
            if (!event) return null;
            return (
              <label key={eid} style={{ display: 'block', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={preferences.includes(eid)}
                  onChange={(e) => {
                    if (e.target.checked && preferences.length < 2) {
                      setPreferences([...preferences, eid]);
                    } else if (!e.target.checked) {
                      setPreferences(preferences.filter(id => id !== eid));
                    }
                  }}
                  disabled={preferences.length >= 2 && !preferences.includes(eid)}
                />
                {event.name}
              </label>
            );
          })}
        </div>

        <div style={{ marginBottom: '15px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Select a Relay</h3>
          <select
            value={relay}
            onChange={(e) => setRelay(e.target.value)}
            style={{ padding: '8px', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">Choose a relay</option>
            {relayEvents.map(eid => {
              const event = events.find(e => e.id === eid);
              return <option key={eid} value={eid}>{event?.name}</option>;
            })}
          </select>
        </div>

        <button
          onClick={savePreferences}
          style={{
            padding: '10px 20px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Submit Preferences
        </button>
      </div>
    );
  };

  // RENDER
  const renderContent = () => {
    if (userRole === 'admin') {
      return (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #ccc' }}>
            {['events', 'houses', 'students', 'import', 'records', 'district'].map(tab => (
              <button
                key={tab}
                onClick={() => setCurrentTab(tab)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: currentTab === tab ? '#2196F3' : '#e0e0e0',
                  color: currentTab === tab ? 'white' : 'black',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '4px 4px 0 0'
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {currentTab === 'events' && <AdminEventsTab />}
          {currentTab === 'houses' && <AdminHousesTab />}
          {currentTab === 'students' && <AdminStudentsTab />}
          {currentTab === 'import' && <AdminImportTab />}
          {currentTab === 'records' && <AdminRecordsTab />}
          {currentTab === 'district' && <AdminDistrictTab />}
        </>
      );
    }

    if (userRole === 'student') {
      return (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #ccc' }}>
            {['profile', 'preferences'].map(tab => (
              <button
                key={tab}
                onClick={() => setCurrentTab(tab)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: currentTab === tab ? '#2196F3' : '#e0e0e0',
                  color: currentTab === tab ? 'white' : 'black',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '4px 4px 0 0'
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {currentTab === 'profile' && <StudentProfileTab />}
          {currentTab === 'preferences' && <StudentPreferencesTab />}
        </>
      );
    }

    return <p>Teacher view coming soon.</p>;
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>🏃 Athletics Manager</h1>
        <button
          onClick={() => {
            setUserRole(null);
            setCurrentTab('events');
          }}
          style={{ padding: '8px 16px', backgroundColor: '#f44336', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
        >
          Logout
        </button>
      </div>
      {renderContent()}
    </div>
  );
};

export default Athletics;
