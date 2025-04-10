const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;

const crypto = require('crypto');

const multer = require('multer');
const path = require('path');

const nodemailer = require('nodemailer');

const mailgun = require('mailgun-js');

// โหลดค่าจาก .env
const DOMAIN = process.env.MAILGUN_DOMAIN;
const API_KEY = process.env.MAILGUN_API_KEY;

const mg = mailgun({ apiKey: API_KEY, domain: DOMAIN });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // โฟลเดอร์สำหรับจัดเก็บไฟล์
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // ตั้งชื่อไฟล์ใหม่
    }
});
const upload = multer({ storage });

// สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
// const https = require('https');
const fs = require('fs');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const sslOptions = {
    key: fs.readFileSync('./server.key'), // Path ไปยังไฟล์ Private Key
    cert: fs.readFileSync('./server.cert') // Path ไปยังไฟล์ Certificate
};

// ตั้งค่า CORS
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // อนุญาตเฉพาะ HTTP Methods ที่ต้องการ
    credentials: true // ถ้าต้องการส่ง cookies หรือ headers อื่นๆ
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://time-attendance-chi.vercel.app');
    next();
}, express.static(path.join(__dirname, 'uploads')));

// Endpoint สำหรับอัปโหลดไฟล์
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded');
    }

    const filePath = `/uploads/${req.file.filename}`; // Path ของไฟล์ที่อัปโหลด
    res.status(200).json({ filePath });
});

// const db = mysql.createConnection({
//   host: 'localhost',
//   user: 'root',
//   password: 'SumorockYeah2!',
//   database: 'leave_time'
// });
const db = mysql.createConnection({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: process.env.DATABASE_PORT || 58890,
});

const secretKey = crypto.randomBytes(32).toString('hex');
console.log('Secret Key:', secretKey);

db.connect((err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  } else {
    console.log('Connected to MySQL database');
  }
});

const faceapi = require('@vladmandic/face-api');
const tf = require('@tensorflow/tfjs-node');

(async () => {
    console.log('Loading FaceAPI models...');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk('./node_modules/@vladmandic/face-api/model'); // โหลดโมเดลตรวจจับใบหน้า
    await faceapi.nets.faceLandmark68Net.loadFromDisk('./node_modules/@vladmandic/face-api/model'); // โหลดโมเดล Landmark
    await faceapi.nets.faceRecognitionNet.loadFromDisk('./node_modules/@vladmandic/face-api/model'); // โหลดโมเดล Face Recognition
    console.log('FaceAPI models loaded successfully');
})();
  
app.post('/checkin', (req, res) => {
    console.log('Request body:', req.body);

    const { idemployees, userLocation, place_name, selectedOption, textInput, checkInDateTime, checkOutDateTime, uploadedFilePath } = req.body;

    if (selectedOption === 'เข้างานออฟฟิศ') {
        // บันทึกข้อมูล "เข้างานออฟฟิศ" ลงในตาราง attendance โดยตรง
        const query = `
            INSERT INTO attendance (idemployees, jobID, location, place_name, jobType, description, in_time, out_time, image_url, isCheckedIn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const jobID = `OF${idemployees}`; // ใช้ jobID แบบคงที่สำหรับ "เข้างานออฟฟิศ"
        const values = [idemployees, jobID, JSON.stringify(userLocation), place_name, selectedOption, textInput, checkInDateTime, checkOutDateTime, uploadedFilePath, 1];

        db.query(query, values, (err, result) => {
            if (err) {
                console.error('Error inserting check-in data:', err.stack);
                res.status(500).send('Error inserting check-in data');
                return;
            } else {
                res.status(200).send('Check-in data inserted successfully');
            }
        });
    } else {
        // กรณีงานอื่น ๆ (เช่น งานนอกสถานที่)
        const baseJobName = selectedOption.replace(/\s\(\d+\)$/, '');

        const checkJobQuery = `
            SELECT jobID FROM job_assignments WHERE jobname = ? AND idemployees = ?
        `;

        db.query(checkJobQuery, [baseJobName, idemployees], (err, jobResult) => {
            if (err) {
                console.error('Error checking job:', err.stack);
                res.status(500).send('Error checking job');
                return;
            }

            if (jobResult.length === 0) {
                res.status(404).send('Job not found');
                return;
            }

            const jobID = jobResult[0].jobID;

            const query = `
                INSERT INTO attendance (idemployees, jobID, location, place_name, jobType, description, in_time, out_time, image_url, isCheckedIn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [idemployees, jobID, JSON.stringify(userLocation), place_name, selectedOption, textInput, checkInDateTime, checkOutDateTime, uploadedFilePath, 1];

            db.query(query, values, (err, result) => {
                if (err) {
                    console.error('Error inserting check-in data:', err.stack);
                    res.status(500).send('Error inserting check-in data');
                    return;
                } else {
                    res.status(200).send('Check-in data inserted successfully');
                }
            });
        });
    }
});

app.post('/checkout', (req, res) => {
    console.log('Request body:', req.body);

    const { jobID, jobname, checkOutDateTime } = req.body;

    const query = `
        UPDATE attendance 
        SET out_time = ?, isCheckedIn = 0
        WHERE jobID = ? AND jobType = ?
        AND isCheckedIn = 1
    `;

    const updateJobAssignmentsQuery = `
        UPDATE job_assignments
        SET isCheckedOut = 1
        WHERE jobID = ?
        AND jobname NOT IN ('เข้างานออฟฟิศ', 'เวลาพิเศษ')
    `

    const values = [checkOutDateTime, jobID, jobname];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating check-out data:', err.stack);
            res.status(500).send('Error updating check-out data');
            return;
        }

        if (result.affectedRows > 0) {
            db.query(updateJobAssignmentsQuery, [jobID], (err, jobResult) => {
                if (err) {
                    console.error('Error updating isCheckedOut in job_assignments:', err.stack);
                    res.status(500).send('Error updating isCheckedOut in job_assignments');
                    return;
                }

                console.log('Check-out data updated successfully:', result);
                res.status(200).send('Check-out data updated successfully');
            });
        } else {
            console.log('No matching record found for check-out');
            res.status(404).send('No matching record found for check-out');
        }
    });
});

app.post('/request-send', (req, res) => {
    console.log('Request body:', req.body);

    const { idemployees, leaveType, leaveStartDate, leaveStartTime, leaveEndDate, leaveEndTime, leaveDescription, leaveLocation, OffsitePlace, leaveStatus } = req.body;

    console.log('Received leaveStartDate:', leaveStartDate);
    console.log('Received leaveStartTime:', leaveStartTime);
    console.log('Received leaveEndDate:', leaveEndDate);
    console.log('Received leaveEndTime:', leaveEndTime);
    
    if (!leaveType || !leaveStartDate || !leaveStartTime || !leaveEndDate || !leaveEndTime || !leaveDescription) {
        console.error('Missing required fields');
        return res.status(400).send('Missing required fields');
    }

    const query = `INSERT INTO requests (idemployees, leaveType, start_date, start_time, end_date, end_time, reason, location, place_name, status ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const values = [idemployees, leaveType, leaveStartDate, leaveStartTime, leaveEndDate, leaveEndTime, leaveDescription, leaveLocation, OffsitePlace, leaveStatus];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error inserting request data:', err.stack);
            res.status(500).send('Error inserting request data');
            return;
        } else {
            res.status(200).send('Request data inserted successfully');

            const emailBody = `
                    <p>คำร้องลาจากพนักงาน:</p>
                    <ul>
                        <li>ประเภทการลา: ${leaveType}</li>
                        <li>วันที่เริ่มต้น: ${leaveStartDate} เวลา: ${leaveStartTime}</li>
                        <li>วันที่สิ้นสุด: ${leaveEndDate} เวลา: ${leaveEndTime}</li>
                        <li>เหตุผล: ${leaveDescription}</li>
                        <li>สถานที่: ${OffsitePlace || 'ไม่ระบุ'}</li>
                    </ul>
                    <p>สถานะ: ${leaveStatus}</p>
            `;

            const data = {
                from: 'Leave & Time Attendance <no-reply@YOUR_DOMAIN_NAME>',
                to: 'sumorockyeah2@gmail.com',
                subject: `แจ้งเตือนคำร้องลาจากพนักงาน`,
                html: emailBody
            };

            mg.messages().send(data, (error, body) => {
                if (error) {
                    console.error('Error sending email:', error);
                    res.status(500).send('Request sent, but failed to send email');
                } else {
                    console.log('Email sent:', body);
                    res.status(200).send('Request sent and email sent successfully');
                }
            });

            // const transporter = nodemailer.createTransport({
            //     service: 'gmail',
            //     auth: {
            //         user: 'sumorockyeah2@gmail.com',
            //         pass: 'yrjsxaiqcrelpbba'
            //     }
            // });

            // const mailOptions = {
            //     from: 'sumorockyeah2@gmail.com',
            //     to: 'sumorockyeah@gmail.com',
            //     subject: 'แจ้งเตือนคำร้องลาจากพนักงาน',
            //     html: `
            //         <p>คำร้องลาจากพนักงาน:</p>
            //         <ul>
            //             <li>ประเภทการลา: ${leaveType}</li>
            //             <li>วันที่เริ่มต้น: ${leaveStartDate} เวลา: ${leaveStartTime}</li>
            //             <li>วันที่สิ้นสุด: ${leaveEndDate} เวลา: ${leaveEndTime}</li>
            //             <li>เหตุผล: ${leaveDescription}</li>
            //             <li>สถานที่: ${OffsitePlace || 'ไม่ระบุ'}</li>
            //         </ul>
            //         <p>สถานะ: ${leaveStatus}</p>
            //     `,
            // };

            // transporter.sendMail(mailOptions, (error, info) => {
            //     if (error) {
            //         console.error('Error sending email:', error);
            //         res.status(500).send('Request saved, but failed to send email');
            //     } else {
            //         console.log('Email sent:', info.response);
            //         res.status(200).send('Request data inserted and email sent successfully');
            //     }
            // });
        }
    });
});

app.post('/empdata-add', (req, res) => {
    console.log('Received data:', req.body);
    const { idemployees, name, department, division, gender, role, phone, email, ipphone, supervisor } = req.body;

    if (!idemployees || !name || !department || !division || !gender || !role || !phone || !email || !ipphone || !supervisor ) {
        return res.status(400).send('All fields are required');
    }

    if (ipphone.length > 4) {
        return res.status(400).send('ipphone must not exceed 4 characters');
    }

    const query = `
        INSERT INTO employees (idemployees, name, department, division, gender, role, phone, email, ipphone, supervisor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [idemployees, name, department, division, gender, role, phone, email, ipphone, supervisor];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error adding employee:', err);
            return res.status(500).send('Error adding employee');
        }

        // เพิ่มข้อมูลวันลาใน leave_hrs
        const leaveQuery = `
            INSERT INTO leave_hrs (idemployees, absence_hrs, sick_hrs, vacation_hrs)
            VALUES (?, 0, 0, 0)
        `;

        db.query(leaveQuery, [idemployees], (leaveErr, leaveResult) => {
            if (leaveErr) {
                console.error('Error adding leave hours:', leaveErr);
                return res.status(500).send('Error adding leave hours');
            }

            res.status(200).send('Employee and leave hours added successfully');
        });
    });
});

app.post('/empdata-check', (req, res) => {
    const { idemployees } = req.body;

    const query = `SELECT COUNT(*) AS count FROM employees WHERE idemployees = ?`;

    db.query(query, [idemployees], (err, result) => {
        if (err) {
            console.error('Error checking employee:', err.stack);
            res.status(500).send('Error checking employee');
        } else {
            res.status(200).json({ exists: result[0].count > 0 });
        }
    });
});

app.post('/attendance-add', (req, res) => {
    console.log('Received data:', req.body);
    const { idattendance, jobID, jobType, description, in_time, out_time, location, image_url } = req.body;

    if (!idattendance || !jobID || !description || !in_time || !out_time) {
        return res.status(400).send('All fields are required');
    }

    const query = `
        INSERT INTO attendance (idattendance, jobID, jobType, description, in_time, out_time, location, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [idattendance, jobID, jobType, description, in_time, out_time, location, image_url];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error adding employee:', err.stack);
            res.status(500).send('Error adding employee');
        } else {
            res.status(200).send('Employee added successfully');
        }
    });
});

app.get('/attendance', (req, res) => {
    const query = `SELECT * FROM attendance`;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching attendance data:', err.stack);
            res.status(500).send('Error fetching attendance data');
            return;
        } else {
            res.status(200).send(results);
        }
    });
});

app.post('/attendance-check', (req, res) => {
    const { idattendance } = req.body;

    const query = `SELECT COUNT(*) AS count FROM attendance WHERE idattendance = ?`;

    db.query(query, [idattendance], (err, result) => {
        if (err) {
            console.error('Error checking attendance:', err.stack);
            res.status(500).send('Error checking attendance');
        } else {
            res.status(200).json({ exists: result[0].count > 0 });
        }
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    console.log('Login request received with:', { email, password });

    if (!email || !password) {
        return res.status(400).send('Email and password are required');
    }

    const query = `
        SELECT uc.idemployees, uc.email, e.name, uc.role
        FROM user_credentials uc
        JOIN employees e ON uc.idemployees = e.idemployees
        WHERE uc.email = ? AND uc.password = ?
    `;
    const values = [email, password];

    db.query(query, values, (err, results) => {
        if (err) {
            console.error('Error checking user credentials:', err.stack);
            res.status(500).send('Error checking user credentials');
        } else {
            console.log('Query results:', results);
            if (results.length > 0) {
                const user = results[0];
                const token = jwt.sign({ id: user.idemployees }, secretKey, { expiresIn: '1h' });
                res.status(200).json({ success: true, user, token });
            } else {
                res.status(200).json({ success: false });
            }
        }
    });
});

app.get('/request-get', (req, res) => {
    const query = `SELECT * FROM requests`;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching request data:', err.stack);
            res.status(500).send('Error fetching request data');
            return;
        } else {
            res.status(200).send(results);
        }
    });
});

app.get('/employee-data', (req, res) => {
    const query = `SELECT * FROM employees`;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching employee data:', err.stack);
            res.status(500).send('Error fetching employee data');
            return;
        } else {
            res.status(200).send(results);
        }
    });
});

app.get('/get-employee-name/:idemployees', (req, res) => {
    const { idemployees } = req.params;
    const query = `SELECT name FROM employees WHERE idemployees = ?`;

    db.query(query, [idemployees], (err, results) => {
        if (err) {
            console.error('Error fetching employee name:', err.stack);
            res.status(500).send('Error fetching employee name');
            return;
        }
        if (results.length > 0) {
            res.status(200).json({ name: results[0].name });
        } else {
            res.status(404).send('Employee not found');
        }
    });
});

async function fetchHolidays() {
    const API_KEY = 'AIzaSyDox1fRNODZVo8U3Pv9LU41l-0nzmK-E2c';
    const CALENDAR_ID = 'th.th#holiday@group.v.calendar.google.com';
    const BASE_URL = `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events`;

    try {
        const response = await fetch(`${BASE_URL}?key=${API_KEY}&singleEvents=true&orderBy=startTime`);
        const data = await response.json();
        return data.items.filter(holiday => holiday.description === "วันหยุดนักขัตฤกษ์");
    } catch (error) {
        console.error('Error fetching holidays:', error);
        return [];
    }
}

function isWorkingDay(date, holidays) {
    const day = date.getDay();
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidays.some(holiday => {
        const holidayDate = new Date(holiday.start.date || holiday.start.dateTime);
        return holidayDate.toDateString() === date.toDateString();
    });
    return !isWeekend && !isHoliday;
}

function calculateLeaveHours(startDateTime, endDateTime) {
    let totalHours = 0;

    while (startDateTime < endDateTime) {
        const workStart = new Date(startDateTime);
        workStart.setHours(8, 30, 0, 0);

        const workEnd = new Date(startDateTime);
        workEnd.setHours(17, 30, 0, 0);

        const lunchStart = new Date(startDateTime);
        lunchStart.setHours(12, 0, 0, 0);

        const lunchEnd = new Date(startDateTime);
        lunchEnd.setHours(13, 0, 0, 0);

        //ข้ามเสาร์-อาทิตย์และวันหยุด กรณีลากิจและลาป่วย
        if (leaveType !== 'ลาพักร้อน' && !isWorkingDay(startDateTime, holidays)) {
            startDateTime.setDate(startDateTime.getDate() + 1);
            startDateTime.setHours(8, 30, 0, 0);
            continue;
        }

        // นอกเวลางาน - ข้าม
        if (startDateTime >= workEnd) {
            startDateTime.setDate(startDateTime.getDate() + 1);
            startDateTime.setHours(8, 30, 0, 0);
            continue;
        }

        // คิดช่วงเช้า
        if (startDateTime < lunchStart) {
            const morningEnd = new Date(Math.min(lunchStart.getTime(), endDateTime.getTime()));
            if (startDateTime < morningEnd) {
                totalHours += (morningEnd - startDateTime) / (1000 * 60 * 60);
                startDateTime = new Date(morningEnd);
            }
        }

        // ข้ามพักเที่ยง
        if (startDateTime >= lunchStart && startDateTime < lunchEnd) {
            startDateTime = new Date(lunchEnd);
        }

        // คิดช่วงบ่าย
        if (startDateTime >= lunchEnd && startDateTime < workEnd) {
            const afternoonEnd = new Date(Math.min(workEnd.getTime(), endDateTime.getTime()));
            if (startDateTime < afternoonEnd) {
                totalHours += (afternoonEnd - startDateTime) / (1000 * 60 * 60);
                startDateTime = new Date(afternoonEnd);
            }
        }

        if (startDateTime >= workEnd) {
            startDateTime.setDate(startDateTime.getDate() + 1);
            startDateTime.setHours(8, 30, 0, 0);
        }
    }

    return totalHours;
}

app.put('/request-update/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const updateQuery = `UPDATE requests SET status = ? WHERE idrequests = ?`;
    const updateValues = [status, id];

    db.query(updateQuery, updateValues, (err, result) => {
        if (err) {
            console.error('Error updating request data:', err.stack);
            res.status(500).send('Error updating request data');
            return;
        } else {
            console.log('Request data updated successfully:', result);
            res.status(200).send('Request data updated successfully');

            const selectQuery = `SELECT * FROM requests WHERE idrequests = ?`;
            db.query(selectQuery, [id], (err, requestResult) => {
                if (err) {
                    console.error('Error fetching request data:', err.stack);
                    res.status(500).send('Error fetching request data');
                    return;
                } else {
                    const requestData = requestResult[0];
                    const startDateTime = new Date(`${requestData.start_date}T${requestData.start_time}`);
                    const endDateTime = new Date(`${requestData.end_date}T${requestData.end_time}`);
                    const leaveHours = calculateLeaveHours(startDateTime, endDateTime);

                    console.log('Calculated leave hours:', leaveHours);

                    let leaveColumn;
                    if (requestData.leaveType === 'ลากิจ') {
                        leaveColumn = 'absence_hrs';
                    } else if (requestData.leaveType === 'ลาป่วย') {
                        leaveColumn = 'sick_hrs';
                    } else if (requestData.leaveType === 'ลาพักร้อน') {
                        leaveColumn = 'vacation_hrs';
                    }

                    if (status === 'อนุมัติแล้ว' && leaveColumn) {
                        const checkLeaveBalanceQuery = `
                            SELECT ${leaveColumn} AS currentBalance
                            FROM leave_hrs
                            WHERE idemployees = ?
                        `;

                        db.query(checkLeaveBalanceQuery, [requestData.idemployees], (err, balanceResult) => {
                            console.log('Check leave balance query:', checkLeaveBalanceQuery);
                            console.log('Query parameters:', [requestData.idemployees]);
                            if (err) {
                                console.error('Error fetching leave balance:', err.stack);
                                res.status(500).send('Error fetching leave balance');
                                return;
                            } else {
                                console.log('Balance Result:', balanceResult);
                                const currentBalance = balanceResult[0].currentBalance;
                                console.log('Current leave balance:', currentBalance);

                                const updateLeaveQuery = `
                                    UPDATE leave_hrs
                                    SET ${leaveColumn} = ${leaveColumn} - ?
                                    WHERE idemployees = ?
                                `;
                                db.query(updateLeaveQuery, [leaveHours, requestData.idemployees], (err, leaveResult) => {
                                    if (err) {
                                        console.error('Error updating leave balance:', err.stack);
                                        res.status(500).send('Error updating leave balance');
                                        return;
                                    }
        
                                    console.log('Leave balance updated successfully:', leaveResult);
        
                                    const transporter = nodemailer.createTransport({
                                        service: 'gmail',
                                        auth: {
                                            user: 'sumorockyeah2@gmail.com',
                                            pass: 'yrjsxaiqcrelpbba'
                                        }
                                    });
                        
                                    const mailOptions = {
                                        from: 'sumorockyeah2@gmail.com',
                                        to: 'sumorockyeah@gmail.com',
                                        subject: `แจ้งเตือน: คำร้อง${status === 'อนุมัติแล้ว' ? 'ผ่านการอนุมัติ' : 'ถูกปฏิเสธ'}`,
                                        html: `
                                            <p>คำร้องลาของคุณ${status === 'อนุมัติแล้ว' ? 'ผ่านการอนุมัติจากหัวหน้าแล้ว' : 'ไม่ผ่านการอนุมัติจากหัวหน้า'}</p>
                                            <ul>
                                                <li>ประเภทการลา: ${requestData.leaveType}</li>
                                                <li>วันที่เริ่มต้น: ${requestData.start_date} เวลา: ${requestData.start_time}</li>
                                                <li>วันที่สิ้นสุด: ${requestData.end_date} เวลา: ${requestData.end_time}</li>
                                                <li>เหตุผล: ${requestData.reason}</li>
                                                <li>สถานะ: ${status}</li>
                                            </ul>
                                        `
                                    };
                        
                                    transporter.sendMail(mailOptions, (error, info) => {
                                        if (error) {
                                            console.error('Error sending email:', error);
                                            res.status(500).send('Request updated, but failed to send email');
                                        } else {
                                            console.log('Email sent:', info.response);
                                            res.status(200).send('Request updated and email sent successfully');
                                        }
                                    });
                                });
                            }
                        });
                    } else {
                        const transporter = nodemailer.createTransport({
                            service: 'gmail',
                            auth: {
                                user: 'sumorockyeah2@gmail.com',
                                pass: 'yrjsxaiqcrelpbba'
                            }
                        });

                        const mailOptions = {
                            from: 'sumorockyeah2@gmail.com',
                            to: 'sumorockyeah@gmail.com',
                            subject: `แจ้งเตือน: คำร้อง${status === 'อนุมัติแล้ว' ? 'ผ่านการอนุมัติ' : 'ถูกปฏิเสธ'}`,
                            html: `
                                <p>คำร้องลาของคุณ${status === 'อนุมัติแล้ว' ? 'ผ่านการอนุมัติจากหัวหน้าแล้ว' : 'ไม่ผ่านการอนุมัติจากหัวหน้า'}</p>
                                <ul>
                                    <li>ประเภทการลา: ${requestData.leaveType}</li>
                                    <li>วันที่เริ่มต้น: ${requestData.start_date} เวลา: ${requestData.start_time}</li>
                                    <li>วันที่สิ้นสุด: ${requestData.end_date} เวลา: ${requestData.end_time}</li>
                                    <li>เหตุผล: ${requestData.reason}</li>
                                    <li>สถานะ: ${status}</li>
                                </ul>
                            `
                        };

                        transporter.sendMail(mailOptions, (error, info) => {
                            if (error) {
                                console.error('Error sending email:', error);
                                res.status(500).send('Request updated, but failed to send email');
                            } else {
                                console.log('Email sent:', info.response);
                                res.status(200).send('Request updated and email sent successfully');
                            }
                        });
                    }
                }
            });
        }
    });
});

app.put('/leave-update', (req, res) => {
    console.log('Received data:', req.body);
    const { idrequests, leaveType, leaveStartDate, leaveStartTime, leaveEndDate, leaveEndTime, leaveDescription, leaveLocation, leaveStatus } = req.body;

    if (!idrequests) {
        return res.status(400).send('idrequests is required');
    }

    const query = `
        UPDATE requests
        SET leaveType = ?, start_date = ?, start_time = ?, end_date = ?, end_time = ?, reason = ?, location = ?, status = ?
        WHERE idrequests = ?
    `;

    const values = [leaveType, leaveStartDate, leaveStartTime, leaveEndDate, leaveEndTime, leaveDescription, leaveLocation, leaveStatus, idrequests];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating request:', err.stack);
            res.status(500).send('Error updating request');
        } else {
            res.status(200).send('Request updated successfully');
        }
    });
});

app.put('/empdata-update', (req, res) => {
    console.log('Received data:', req.body);
    const { idemployees, name, department, division, gender, role, phone, email, ipphone, supervisor, image } = req.body;

    if (!idemployees) {
        return res.status(400).send('idemployees is required');
    }

    const query = `
        UPDATE employees
        SET name = ?, department = ?, division = ?, gender = ?, role = ?, phone = ?, email = ?, ipphone = ?, supervisor = ?, image = ?
        WHERE idemployees = ?
    `;

    const values = [name, department, division, gender, role, phone, email, ipphone, supervisor, image, idemployees];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating request:', err.stack);
            res.status(500).send('Error updating request');
        } else {
            res.status(200).send('Request updated successfully');
        }
    });
});

app.put('/attendance-update', (req, res) => {
    console.log('Received data:', req.body);
    const { idattendance, jobID, jobType, description, in_time, out_time, location, image_url, place_name } = req.body;

    if (!idattendance) {
        return res.status(400).send('idemployees is required');
    }

    const query = `
        UPDATE attendance
        SET jobID = ?, jobType = ?, description = ?, in_time = ?, out_time = ?, location = ?, image_url = ?, place_name = ?
        WHERE idattendance = ?
    `;

    const values = [jobID, jobType, description, in_time, out_time, location, image_url, place_name, idattendance];

    console.log('Query:', query);
    console.log('Values:', values);

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating attendance:', err.stack);
            res.status(500).send('Error updating attendance');
        } else {
            res.status(200).send('attendance updated successfully');
        }
    });
});

app.delete('/empdata-remove/:idemployees', (req, res) => {
    const { idemployees } = req.params;

    const deleteEmployeeQuery = 'DELETE FROM employees WHERE idemployees = ?';
    const deleteUserCredentialsQuery = 'DELETE FROM user_credentials WHERE idemployees = ?';

    db.query(deleteEmployeeQuery, [idemployees], (err, employeeResult) => {
        if (err) {
            console.error('Error deleting employee:', err);
            return res.status(500).send('Error deleting employee');
        }

        db.query(deleteUserCredentialsQuery, [idemployees], (err, credentialsResult) => {
            if (err) {
                console.error('Error deleting user credentials:', err);
                return res.status(500).send('Error deleting user credentials');
            }

            res.status(200).send('Employee and user credentials deleted successfully');
        });
    });
});

app.delete('/attendance-remove/:idattendance', (req, res) => {
    const { idattendance } = req.params;

    const query = `
        DELETE FROM attendance WHERE idattendance = ?
    `;

    db.query(query, [idattendance], (err, result) => {
        if (err) {
            console.error('Error removing attendance:', err.stack);
            res.status(500).send('Error removing attendance');
        } else {
            res.status(200).send('Attendance removed successfully');
        }
    });
});

app.post('/jobs', (req, res) => {
    console.log('Request body:', req.body);

    const { employeeId, jobID, jobName, jobDesc, startDate, startTime, endDate, endTime, latitude, longitude, radius, place_name } = req.body;

    if (!employeeId || !jobName || !jobDesc) {
        return res.status(400).send('All fields are required');
    }

    const query = `INSERT INTO job_assignments (idemployees, jobID, jobname, jobdesc, start_date, start_time, end_date, end_time, latitude, longitude, gps_radius, place_name ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [employeeId, jobID, jobName, jobDesc, startDate, startTime, endDate, endTime, latitude, longitude, radius, place_name];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error inserting job data:', err.stack);
            res.status(500).send('Error inserting job data');
        } else {
            res.status(200).send('Job data inserted successfully');
        }
    });
});

app.get('/get-assigned-jobs/:employeeID', (req, res) => {
    const employeeID = req.params.employeeID;

    const query = `
        SELECT ja.jobID, ja.jobname, ja.latitude, ja.longitude, ja.gps_radius, ja.weekdays, ja.start_date, ja.start_time, ja.end_date, ja.end_time, ja.place_name
        FROM job_assignments ja
        WHERE ja.idemployees = ?
            AND (ja.isCheckedOut IS NULL OR ja.isCheckedOut = 0)
            AND (
                (ja.start_date IS NULL OR ja.start_date <= CURDATE())
                AND (ja.end_date IS NULL OR ja.end_date >= CURDATE())
            )
    `;

    db.query(query, [employeeID], (err, results) => {
        if (err) {
            console.error('Error fetching job assignments:', err.stack);
            res.status(500).send('Error fetching job assignments');
            return;
        }

        res.status(200).json(results);
    });
});

app.get('/get-checked-in-jobs/:employeeID', (req, res) => {
    const employeeID = req.params.employeeID;

    const query = `
        SELECT a.jobID, a.jobType AS jobname, a.location, a.place_name, a.in_time, a.out_time, ja.latitude, ja.longitude, ja.gps_radius
        FROM attendance a
        LEFT JOIN job_assignments ja ON a.jobID = ja.jobID
        WHERE a.idemployees = ?
          AND (
              ja.jobname = 'เวลาพิเศษ' -- แสดง "เวลาพิเศษ" เสมอ
              OR (a.out_time IS NULL OR a.out_time = 'Pending') -- เงื่อนไขสำหรับงานอื่น ๆ
          )
    `;

    db.query(query, [employeeID], (err, results) => {
        if (err) {
            console.error('Error fetching checked-in jobs:', err.stack);
            res.status(500).send('Error fetching checked-in jobs');
        } else {
            console.log('Fetched checked-in jobs:', results);
            res.status(200).json(results);
        }
    });
});

app.post('/jobs-office', (req, res) => {
    console.log('Request body:', req.body);

    const { employeeId, jobName, jobDesc, weekdays, startTime, endTime, latitude, longitude, radius } = req.body;

    if (!employeeId || !jobName || !jobDesc || !weekdays) {
        return res.status(400).send('All fields are required');
    }

    // Query to find the next available jobID
    const getNextJobIDQuery = `
        SELECT jobID 
        FROM job_assignments 
        WHERE jobID LIKE 'OF%' 
        ORDER BY jobID DESC 
        LIMIT 1
    `;

    db.query(getNextJobIDQuery, (err, results) => {
        if (err) {
            console.error('Error fetching job IDs:', err.stack);
            res.status(500).send('Error fetching job IDs');
            return;
        }

        let nextJobID = 'OF01'; // Default jobID if no existing IDs are found
        if (results.length > 0) {
            const lastJobID = results[0].jobID;
            const lastNumber = parseInt(lastJobID.substring(2), 10); // Extract the numeric part
            nextJobID = `OF${String(lastNumber + 1).padStart(2, '0')}`; // Increment and pad with leading zeros
        }

        // Insert the new job with the generated jobID
        const insertJobQuery = `
            INSERT INTO job_assignments (jobID, idemployees, jobname, jobdesc, weekdays, start_time, end_time, latitude, longitude, gps_radius)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [nextJobID, employeeId, jobName, jobDesc, weekdays, startTime, endTime, latitude, longitude, radius];

        db.query(insertJobQuery, values, (err, result) => {
            if (err) {
                console.error('Error inserting office job data:', err.stack);
                res.status(500).send('Error inserting office job data');
            } else {
                res.status(200).send('Office job data inserted successfully');
            }
        });
    });
});

app.post('/add-job', (req, res) => {
    console.log('Request body:', req.body);
    const { jobID, idemployees, jobname, jobdesc, latitude, longitude, radius, start_date, start_time, end_date, end_time } = req.body;

    if (!idemployees || !jobname || !jobdesc || !latitude || !longitude || !radius) {
        return res.status(400).send('All fields are required');
    }

    const query = `
        INSERT INTO job_assignments (jobID, idemployees, jobname, jobdesc, latitude, longitude, gps_radius, start_date, start_time, end_date, end_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [jobID, idemployees, jobname, jobdesc, latitude, longitude, radius, start_date, start_time, end_date, end_time];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error inserting job:', err.stack);
            res.status(500).send('Error inserting job');
        } else {
            res.status(200).send('Job added successfully');
        }
    });
});

app.get('/get-next-job-id', (req, res) => {
    const getLastJobIDQuery = `
        SELECT jobID 
        FROM job_assignments 
        WHERE jobID LIKE 'OUT%' 
        ORDER BY jobID DESC 
        LIMIT 1
    `;

    db.query(getLastJobIDQuery, (err, results) => {
        if (err) {
            console.error('Error fetching job IDs:', err.stack);
            res.status(500).send('Error fetching job IDs');
            return;
        }

        let nextJobID = 'OUT01'; // Default jobID if no existing IDs are found
        if (results.length > 0) {
            const lastJobID = results[0].jobID;
            const lastNumber = parseInt(lastJobID.substring(3), 10); // Extract the numeric part
            nextJobID = `OUT${String(lastNumber + 1).padStart(2, '0')}`; // Increment and pad with leading zeros
        }

        res.status(200).json({ nextJobID });
    });
});

app.post('/late-checkin', (req, res) => {
    console.log('Request body:', req.body);

    const { idemployees, jobID, jobType, userLocation, place_name, textInput, checkInDateTime, checkOutDateTime, uploadedFilePath } = req.body;

    // Insert leave data into the attendance table
    const query = `
        INSERT INTO attendance (idemployees, jobID, jobType, location, place_name, description, in_time, out_time, image_url, isCheckedIn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
        idemployees,
        'LATE', // Fixed jobID for late check-ins
        'คำร้องย้อนหลัง',
        JSON.stringify(userLocation),
        place_name || 'none',
        textInput,
        checkInDateTime,
        checkOutDateTime,
        uploadedFilePath,
        0 // Mark as checked-in
    ];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error inserting leave-checkin data:', err.stack);
            res.status(500).send('Error inserting leave-checkin data');
            return;
        } else {
            res.status(200).send('Leave-checkin data inserted successfully');
        }
    });
});

app.get('/orglist', (req, res) => {
    const query = `
        SELECT DISTINCT iddep, depname, divname
        FROM orglist
        WHERE depname IS NOT NULL AND depname != ''
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching orglist data:', err.stack);
            res.status(500).send('Error fetching orglist data');
        } else {
            // Group divisions under their respective departments
            const groupedData = results.reduce((acc, row) => {
                const { iddep, depname, divname } = row;
                if (!acc[depname]) {
                    acc[depname] = { iddep, divisions: [] };
                }
                if (divname) {
                    acc[depname].divisions.push(divname);
                }
                return acc;
            }, {});

            // Convert grouped data to an array
            const response = Object.keys(groupedData).map(depname => ({
                iddep: groupedData[depname].iddep,
                depname,
                divisions: groupedData[depname].divisions
            }));

            res.status(200).json(response);
        }
    });
});

app.get('/employee-search', (req, res) => {
    const { department, division } = req.query;

    console.log('Query Parameters:', { department, division });

    let query = `
        SELECT e.idemployees, e.name, e.department, e.division, o.depname AS department_name, o.divname AS division_name
        FROM employees e
        INNER JOIN orglist o ON e.department = o.depname AND e.division = o.divname
        WHERE 1=1
    `;

    const params = [];

    if (department) {
        query += ` AND o.depname = ?`;
        params.push(department);
    }

    if (division) {
        query += ` AND o.divname = ?`;
        params.push(division);
    }

    console.log('SQL Query:', query);
    console.log('Parameters:', params);

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching filtered employee data:', err.stack);
            res.status(500).send('Error fetching filtered employee data');
        } else {
            res.status(200).json(results);
        }
    });
});

app.get('/get-office-job/:employeeId', (req, res) => {
    const { employeeId } = req.params;

    const query = `
        SELECT * FROM job_assignments
        WHERE idemployees = ? AND jobname = 'เข้างานออฟฟิศ'
    `;

    db.query(query, [employeeId], (err, results) => {
        if (err) {
            console.error('Error fetching office job:', err.stack);
            res.status(500).send('Error fetching office job');
        } else {
            res.status(200).json(results[0] || null);
        }
    });
});

app.put('/update-office-time', (req, res) => {
    const { employeeId, weekdays, startTime, endTime, latitude, longitude, radius } = req.body;

    if (!employeeId || !startTime || !endTime || !weekdays) {
        return res.status(400).send('All fields are required');
    }

    const query = `
        UPDATE job_assignments
        SET weekdays = ?, start_time = ?, end_time = ?, latitude = ?, longitude = ?, gps_radius = ?
        WHERE idemployees = ? AND jobname = 'เข้างานออฟฟิศ'
    `;
    const values = [weekdays, startTime, endTime, latitude, longitude, radius, employeeId];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating office job:', err.stack);
            res.status(500).send('Error updating office job');
        } else {
            res.status(200).send('Office job updated successfully');
        }
    });
});

app.post('/add-special-hours', (req, res) => {
    const { employeeId, weekdays, startTime, endTime, latitude, longitude, radius } = req.body;

    if (!employeeId || !weekdays || !startTime || !endTime) {
        return res.status(400).send('All fields are required');
    }

    const query = `
        INSERT INTO job_assignments (idemployees, jobID, jobname, jobdesc, weekdays, start_time, end_time, latitude, longitude, gps_radius)
        VALUES (?, ?, 'เวลาพิเศษ', 'เวลาทำงานพิเศษ', ?, ?, ?, ?, ?, ?)
    `;
    const jobID = `OF02`; // สร้าง jobID สำหรับเวลาพิเศษ
    const values = [employeeId, jobID, weekdays, startTime, endTime, latitude, longitude, radius];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error adding special hours:', err.stack);
            res.status(500).send('Error adding special hours');
        } else {
            res.status(200).send('Special hours added successfully');
        }
    });
});

app.put('/update-special-hours', (req, res) => {
    const { jobID, weekdays, startTime, endTime, latitude, longitude, radius } = req.body;

    if (!jobID || !weekdays || !startTime || !endTime) {
        return res.status(400).send('All fields are required');
    }

    const query = `
        UPDATE job_assignments
        SET weekdays = ?, start_time = ?, end_time = ?, latitude = ?, longitude = ?, gps_radius = ?
        WHERE jobID = ? AND jobname = 'เวลาพิเศษ'
    `;
    const values = [weekdays, startTime, endTime, latitude, longitude, radius, jobID];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating special hours:', err.stack);
            res.status(500).send('Error updating special hours');
        } else {
            res.status(200).send('Special hours updated successfully');
        }
    });
});

app.get('/get-special-jobs/:employeeId', (req, res) => {
    const { employeeId } = req.params;

    const query = `
        SELECT * FROM job_assignments
        WHERE idemployees = ? AND jobname = 'เวลาพิเศษ'
    `;

    db.query(query, [employeeId], (err, results) => {
        if (err) {
            console.error('Error fetching special jobs:', err.stack);
            res.status(500).send('Error fetching special jobs');
        } else {
            res.status(200).json(results);
        }
    });
});

app.delete('/delete-special-job/:idemployees', (req, res) => {
    const { idemployees } = req.params;

    const query = `
        DELETE FROM job_assignments
        WHERE idemployees = ? AND jobID = 'OF02' AND jobname = 'เวลาพิเศษ'
    `;

    db.query(query, [idemployees], (err, result) => {
        if (err) {
            console.error('Error deleting special job:', err.stack);
            res.status(500).send('Error deleting special job');
        } else {
            if (result.affectedRows > 0) {
                res.status(200).send('Special job deleted successfully');
            } else {
                res.status(404).send('Special job not found');
            }
        }
    });
});

app.get('/leave-balance/:idemployees', (req, res) => {
    const { idemployees } = req.params;

    const query = `
        SELECT
            absence_hrs,
            sick_hrs,
            vacation_hrs
        FROM leave_hrs
        WHERE idemployees = ?
    `;

    db.query(query, [idemployees], (err, results) => {
        if (err) {
            console.error('Error fetching leave balance:', err.stack);
            res.status(500).send('Error fetching leave balance');
            return;
        }

        if (results.length > 0) {
            res.status(200).json(results[0]);
        } else {
            res.status(404).send('Leave balance not found');
        }
    });
});

app.put('/leave-balance-update/:idemployees', (req, res) => {
    const { idemployees } = req.params;
    const { absence_hrs, sick_hrs, vacation_hrs } = req.body;

    const updates = [];
    const values = [];

    if (absence_hrs !== undefined) {
        updates.push('absence_hrs = ?');
        values.push(absence_hrs);
    }
    if (sick_hrs !== undefined) {
        updates.push('sick_hrs = ?');
        values.push(sick_hrs);
    }
    if (vacation_hrs !== undefined) {
        updates.push('vacation_hrs = ?');
        values.push(vacation_hrs);
    }

    if (updates.length === 0) {
        return res.status(400).send('No fields to update');
    }

    const query = `
        UPDATE leave_hrs
        SET ${updates.join(', ')}
        WHERE idemployees = ?
    `;
    values.push(idemployees);

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating leave balance:', err.stack);
            return res.status(500).send('Error updating leave balance');
        }

        if (result.affectedRows > 0) {
            res.status(200).send('Leave balance updated successfully');
        } else {
            res.status(404).send('Employee not found');
        }
    });
});

app.get('/get-all-offsite-jobs', (req, res) => {
    const query = `
        SELECT ja.jobID, ja.jobname, ja.latitude, ja.longitude, ja.gps_radius, ja.weekdays, ja.start_date, ja.start_time, ja.end_date, ja.end_time, ja.place_name, ja.idemployees
        FROM job_assignments ja
        WHERE ja.jobname LIKE 'งานนอกสถานที่%'
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching all offsite jobs:', err.stack);
            res.status(500).send('Error fetching all offsite jobs');
            return;
        }

        res.status(200).json(results);
    });
});

app.post('/check-leave-overlap', (req, res) => {
    const { idemployees, startDateTime, endDateTime } = req.body;

    if (!idemployees || !startDateTime || !endDateTime) {
        return res.status(400).send({ message: 'Missing required fields' });
    }

    const query = `
        SELECT COUNT(*) AS overlapCount
        FROM attendance
        WHERE idemployees = ?
          AND (
              (in_time <= ? AND out_time >= ?) OR
              (in_time <= ? AND out_time >= ?) OR
              (in_time >= ? AND out_time <= ?)
          )
    `;

    const values = [
        idemployees,
        startDateTime, startDateTime,
        endDateTime, endDateTime,
        startDateTime, endDateTime,
    ];

    db.query(query, values, (err, results) => {
        if (err) {
            console.error('Error checking leave overlap:', err.stack);
            return res.status(500).send({ message: 'Error checking leave overlap' });
        }

        const overlap = results[0].overlapCount > 0;
        res.status(200).send({ overlap });
    });
});

app.get('/supervisor-search', (req, res) => {
    const query = `
        SELECT idemployees, name
        FROM employees
        WHERE role = 'Supervisor'
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching supervisors:', err.stack);
            res.status(500).send('Error fetching supervisors');
        } else {
            res.status(200).json(results);
        }
    });
});

app.get('/user-credentials', (req, res) => {
    const query = `SELECT idemployees, password FROM user_credentials`;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching user credentials:', err.stack);
            res.status(500).send('Error fetching user credentials');
            return;
        } else {
            res.status(200).json(results);
        }
    });
});

app.put('/user-credentials-update', async (req, res) => {
    console.log('Request body received:', req.body);
    const { idemployees, role, password, email } = req.body;

    if (!idemployees || !role || !password || !email) {
        console.error('Missing required fields:', { idemployees, role, password, email });
        return res.status(400).send('Missing required fields');
    }

    const query = 'UPDATE user_credentials SET role = ?, password = ?, email = ? WHERE idemployees = ?';
    db.query(query, [role, password, email, idemployees], (err, result) => {
        if (err) {
            console.error('Error updating user_credentials:', err);
            return res.status(500).send('Internal server error');
        }

        if (result.affectedRows > 0) {
            res.status(200).send('User credentials updated successfully');
        } else {
            res.status(404).send('User not found');
        }
    });
});

app.post('/user-credentials-add', (req, res) => {
    const { idusers, email, username, idemployees, role, password } = req.body;

    if (!idusers || !email || !username || !idemployees || !role || !password) {
        return res.status(400).send('Missing required fields');
    }

    const query = `
        INSERT INTO user_credentials (idusers, email, username, idemployees, role, password)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [idusers, email, username, idemployees, role, password], (err, result) => {
        if (err) {
            console.error('Error adding user credentials:', err);
            return res.status(500).send('Error adding user credentials');
        }

        res.status(200).send('User credentials added successfully');
    });
});

// API สำหรับดึงค่ารัศมี GPS
app.get('/api/settings-fetch', (req, res) => {
    const { jobID } = req.query;
    console.log('Received jobID:', jobID);

    const query = `SELECT gps_radius, location FROM settings WHERE jobID = ?`;
    db.query(query, [jobID], (err, results) => {
        if (err) {
            console.error('Error fetching GPS radius & location:', err.stack);
            res.status(500).send('Error fetching GPS radius & location');
        } else if (results.length === 0) {
            res.status(404).send('Job ID not found');
        } else {
            res.status(200).json({ gps_radius: results[0].gps_radius, location: results[0].location });
        }
    });
});

// API สำหรับอัปเดตรัศมี GPS
app.put('/api/settings-update', (req, res) => {
    const { jobID, gps_radius, location } = req.body;
    console.log('Received data:', req.body);

    if (!jobID || !gps_radius || !location) {
        return res.status(400).send('Missing required fields');
    }

    const query = `UPDATE settings SET gps_radius = ?, location = ? WHERE jobID = ?`;
    db.query(query, [gps_radius, JSON.stringify(location), jobID], (err, result) => {
        if (err) {
            console.error('Error updating GPS radius:', err.stack);
            res.status(500).send('Error updating GPS radius');
        } else if (result.affectedRows === 0) {
            res.status(404).send('Job ID not found');
        } else {
            res.status(200).send('GPS radius location updated successfully');
        }
    });
});

const { Canvas, Image, ImageData } = require('canvas');
const { request } = require('http');
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
// Endpoint สำหรับตรวจสอบใบหน้า
app.post('/auth/facial-recognition', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No image uploaded');
    }

    console.log('Received face image:', req.file.path);

    try {
        // โหลดภาพจากไฟล์ที่อัปโหลด
        const imageBuffer = fs.readFileSync(req.file.path);
        const image = new Image();
        image.src = imageBuffer;

        // ตรวจจับใบหน้าและสร้าง face descriptor
        const detections = await faceapi.detectSingleFace(image)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detections) {
            console.log('No face detected');
            return res.status(400).json({ success: false, message: 'No face detected' });
        }

        console.log('Face descriptor:', detections.descriptor);

        // เรียกใช้ฟังก์ชัน recognizeFace เพื่อเปรียบเทียบ face descriptor
        const bestMatch = await recognizeFace(detections.descriptor);

        if (bestMatch) {
            // ดึงข้อมูลผู้ใช้จากฐานข้อมูล
            const query = `
                SELECT uc.idemployees, uc.email, e.name, uc.role
                FROM user_credentials uc
                JOIN employees e ON uc.idemployees = e.idemployees
                WHERE uc.username = ?
            `
            // const query = `SELECT * FROM user_credentials WHERE username = ?`;
            db.query(query, [bestMatch.username], (err, results) => {
                if (err) {
                    console.error('Error fetching user data:', err);
                    return res.status(500).send('Error fetching user data');
                }

                if (results.length > 0) {
                    const user = results[0];
                    const token = jwt.sign({ id: user.idemployees }, secretKey, { expiresIn: '1h' });
                    res.status(200).json({ success: true, user, token });
                } else {
                    res.status(404).json({ success: false, message: 'User not found' });
                }
            });
        } else {
            res.status(200).json({ success: false, message: 'Face not recognized' });
        }
    } catch (error) {
        console.error('Error processing face image:', error);
        res.status(500).send('Error processing face image');
    }
});

// ฟังก์ชันสำหรับเปรียบเทียบ face descriptor
async function recognizeFace(detectedDescriptor) {
    console.log('RecognizeFace method called');

    // ดึงข้อมูลผู้ใช้ทั้งหมดจากฐานข้อมูล
    const users = await getAllUsersFromDatabase(); // คุณต้องสร้างฟังก์ชันนี้เพื่อดึงข้อมูลผู้ใช้จากฐานข้อมูล
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const user of users) {
        try {
            const storedDescriptor = JSON.parse(user.face_descriptor); // แปลง descriptor ที่เก็บไว้ในฐานข้อมูลกลับเป็นอาร์เรย์
            console.log(`Stored descriptor for user ${user.username}`);

            const distance = faceapi.euclideanDistance(detectedDescriptor, storedDescriptor);
            console.log(`Distance between detected face and user ${user.username}:`, distance);

            if (distance < 0.5 && distance < bestDistance) { // ค่า threshold สำหรับการตรวจสอบใบหน้า
                bestDistance = distance;
                bestMatch = { username: user.username, distance };
            }
        } catch (error) {
            console.error(`Error parsing face descriptor for user ${user.username}:`, error);
        }
    }

    if (bestMatch) {
        console.log(`Best match found for user ${bestMatch.username} with distance ${bestMatch.distance}`);
        return bestMatch;
    } else {
        console.error('No matching face found');
        return null;
    }
}

// ฟังก์ชันสำหรับดึงข้อมูลผู้ใช้จากฐานข้อมูล
async function getAllUsersFromDatabase() {
    return new Promise((resolve, reject) => {
        const query = 'SELECT username, face_descriptor FROM user_credentials'; // ปรับตามโครงสร้างตารางของคุณ
        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching users from database:', err);
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
}

app.post('/upload-face-descriptor', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No image uploaded');
    }

    const { idemployees } = req.body;

    if (!idemployees) {
        return res.status(400).send('Employee ID is required');
    }

    console.log('Received face image:', req.file.path);

    try {
        // โหลดภาพจากไฟล์ที่อัปโหลด
        const imageBuffer = fs.readFileSync(req.file.path);
        const image = new Image();
        image.src = imageBuffer;

        // ตรวจจับใบหน้าและสร้าง face descriptor
        const detections = await faceapi.detectSingleFace(image)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detections) {
            console.log('No face detected');
            return res.status(400).json({ success: false, message: 'No face detected' });
        }

        const faceDescriptorArray = Array.from(detections.descriptor);
        console.log('Face descriptor:', faceDescriptorArray);

        // บันทึก face descriptor ลงในฐานข้อมูล
        const query = `
            UPDATE user_credentials
            SET face_descriptor = ?
            WHERE idemployees = ?
        `;
        const values = [JSON.stringify(faceDescriptorArray), idemployees];
        console.log('values: ', values);

        db.query(query, values, (err, result) => {
            if (err) {
                console.error('Error saving face descriptor:', err);
                return res.status(500).send('Error saving face descriptor');
            }

            if (result.affectedRows > 0) {
                res.status(200).json({ success: true, message: 'Face descriptor saved successfully' });
            } else {
                res.status(404).json({ success: false, message: 'Employee not found' });
            }
        });
    } catch (error) {
        console.error('Error processing face image:', error);
        res.status(500).send('Error processing face image');
    }
});

app.post('/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded');
    }
    const filePath = `/uploads/${req.file.filename}`;
    res.status(200).json({ filePath });
});

app.get('/get-profile-image/:idemployees', (req, res) => {
    const { idemployees } = req.params;

    const query = `SELECT image FROM employees WHERE idemployees = ?`;

    db.query(query, [idemployees], (err, results) => {
        if (err) {
            console.error('Error fetching profile image:', err.stack);
            res.status(500).send('Error fetching profile image');
        } else if (results.length > 0) {
            res.status(200).json({ image: results[0].image });
        } else {
            res.status(404).send('Profile image not found');
        }
    });
});

app.get('/get-employee/:idemployees', (req, res) => {
    const { idemployees } = req.params;

    const query = `SELECT * FROM employees WHERE idemployees = ?`;

    db.query(query, [idemployees], (err, results) => {
        if (err) {
            console.error('Error fetching employee data:', err.stack);
            res.status(500).send('Error fetching employee data');
        } else if (results.length > 0) {
            res.status(200).json(results[0]);
        } else {
            res.status(404).send('Employee not found');
        }
    });
});

// https.createServer(sslOptions, app).listen(port, '0.0.0.0', () => {
//     console.log(`HTTPS Server running on https://0.0.0.0:${port}`);
// });

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../build')));

// Catch-all handler for any request that doesn't match an API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});