import bcrypt from "bcryptjs";
import { one, run, transaction } from "./db.js";
import { cleanQuestionInput, insertQuestion } from "./lib/questions.js";
import { generateAutoQuizzes } from "./lib/quizgen.js";

const mcq = (text, opts, correct, explanation, difficulty = "Easy") => ({ question_text: text, question_type: "mcq", difficulty, explanation, options: opts.map((t, i) => ({ label: String.fromCharCode(65 + i), text: t, correct: i === correct })) });
const tf = (text, answer, explanation, difficulty = "Easy") => ({ question_text: text, question_type: "true_false", answer_text: answer, explanation, difficulty });
const sa = (text, answer, explanation, difficulty = "Medium") => ({ question_text: text, question_type: "short_answer", answer_text: answer, explanation, difficulty });
const la = (text, answer, difficulty = "Hard") => ({ question_type: "long_answer", question_text: text, answer_text: answer, difficulty, marks: 5 });

export function seedDemo() {
  if (process.env.SEED_DEMO === "false" || one("SELECT COUNT(*) n FROM users").n) return;
  transaction(() => {
    const teacher = run("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)", ["Aarav Sharma", "teacher@learnsphere.dev", bcrypt.hashSync("teacher123", 10), "teacher"]);
    const student = run("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)", ["Riya Verma", "student@learnsphere.dev", bcrypt.hashSync("student123", 10), "student"]);

    const ml = run("INSERT INTO courses(title,description,category,level,teacher_id) VALUES(?,?,?,?,?)", ["Machine Learning Foundations", "Build a strong foundation in machine learning, from core concepts to practical algorithms.", "Artificial Intelligence", "Beginner", teacher]);
    const web = run("INSERT INTO courses(title,description,category,level,teacher_id) VALUES(?,?,?,?,?)", ["Modern Web Development", "Learn how the modern web works, from HTML and CSS to JavaScript and APIs.", "Development", "Beginner", teacher]);
    const chapter = (course, title, pos) => run("INSERT INTO chapters(course_id,title,position) VALUES(?,?,?)", [course, title, pos]);
    const topic = (ch, title, content, pos = 1) => run("INSERT INTO topics(chapter_id,title,content,position) VALUES(?,?,?,?)", [ch, title, content, pos]);

    const c1 = chapter(ml, "Introduction to Machine Learning", 1), c2 = chapter(ml, "Supervised Learning", 2), c3 = chapter(ml, "Model Evaluation", 3), w1 = chapter(web, "Web Fundamentals", 1);
    const t1 = topic(c1, "What is Machine Learning?", "Machine learning is a field of artificial intelligence that enables computer systems to learn patterns from data and make predictions or decisions without being explicitly programmed for every situation.\n\n## How it works\n1. Collect relevant data.\n2. Choose a model.\n3. Train the model using examples.\n4. Evaluate it on unseen data.\n5. Use it to make predictions.\n\n## Example\nAn email spam filter learns from labelled examples of spam and legitimate messages, then predicts whether a new email is spam.");
    topic(c1, "Types of Machine Learning", "## Three families\n- **Supervised learning** learns from labelled examples.\n- **Unsupervised learning** finds structure in unlabelled data, such as clusters.\n- **Reinforcement learning** learns by trial and error using rewards.\n\nChoosing a family depends on the data you have and the question you want to answer.", 2);
    topic(c2, "Supervised Learning", "Supervised learning trains a model using labelled examples. Each training example contains input features and a known target.\n\n### Main task types\n- Classification: predict a category, such as spam or not spam.\n- Regression: predict a numeric value, such as a house price.\n\nThe model learns a mapping from inputs to outputs and is evaluated using data it has not seen during training.");
    topic(c2, "Linear Regression", "Linear regression fits a straight line (or hyperplane) to the data by minimising the squared difference between predictions and true values.\n\n## Key ideas\n- The model is y = w·x + b.\n- The loss is the mean squared error.\n- Gradient descent or the normal equation finds the best weights.", 2);
    topic(c3, "Overfitting and Generalisation", "A model **overfits** when it memorises noise in the training data and performs poorly on new data.\n\n## Ways to reduce overfitting\n- Collect more training data.\n- Use a simpler model.\n- Apply regularisation.\n- Use cross-validation to measure performance on unseen data.");
    topic(w1, "How the Web Works", "The web follows a client-server model. A browser sends an HTTP request to a server, and the server returns a response such as HTML, CSS, JavaScript or JSON.\n\n### Core technologies\n- HTML structures content.\n- CSS controls presentation.\n- JavaScript adds interactivity.\n- HTTP transfers requests and responses.");

    const add = (course, chapter_id, q) => insertQuestion(cleanQuestionInput(q), { course_id: course, chapter_id, user_id: teacher, status: "approved" });
    [
      mcq("Which statement best describes machine learning?", ["A computer following only fixed instructions", "A system learning patterns from data", "A database storing files", "A programming language"], 1, "Machine learning learns patterns from data to make predictions or decisions."),
      tf("A spam filter trained on labelled emails is an example of machine learning.", "True", "It learns patterns from labelled examples."),
      mcq("Which family of machine learning learns from rewards?", ["Supervised", "Unsupervised", "Reinforcement", "Transfer"], 2, "Reinforcement learning uses rewards from trial and error.", "Medium"),
      sa("Name the step in the ML workflow that uses unseen data.", "Evaluation", "A model is evaluated on data it has not seen during training.", "Medium"),
    ].forEach(q => add(ml, c1, q));
    [
      tf("Supervised learning uses labelled training data.", "True", "Each training example includes the expected target or label."),
      mcq("Which task predicts a numeric value?", ["Classification", "Regression", "Clustering", "Ranking"], 1, "Regression predicts numbers such as a house price."),
      sa("What loss function does linear regression usually minimise?", "mean squared error | MSE", "Least squares minimises the mean squared error."),
      la("Explain linear regression with a suitable example.", "Linear regression models a numeric target as a weighted sum of input features, y = w·x + b. The weights are chosen to minimise the mean squared error between predictions and true values, for example predicting house price from area."),
    ].forEach(q => add(ml, c2, q));
    [
      mcq("Overfitting occurs when a model…", ["Is too simple", "Memorises noise in the training data", "Has no parameters", "Is untrained"], 1, "It scores well on training data but poorly on new data.", "Medium"),
      tf("Adding more training data can help reduce overfitting.", "True", "More examples make it harder to memorise noise."),
      sa("Define overfitting.", "A model that learns noise in the training data and fails to generalise to new data", "", "Medium"),
      la("Describe three ways to reduce overfitting.", "Collect more data, use a simpler model, apply regularisation, and use cross-validation to detect it early."),
    ].forEach(q => add(ml, c3, q));
    [
      mcq("Which technology is responsible for the structure of a web page?", ["HTML", "CSS", "JavaScript", "SQL"], 0, "HTML defines the structure and meaning of web content."),
      tf("CSS is used to control how a page looks.", "True", "CSS controls presentation."),
      mcq("Which protocol transfers web pages between browser and server?", ["FTP", "HTTP", "SMTP", "SSH"], 1, "HTTP transfers requests and responses.", "Medium"),
      sa("What does a browser send to a server to ask for a page?", "HTTP request | request", "The server replies with a response.", "Easy"),
    ].forEach(q => add(web, w1, q));

    run("INSERT INTO enrollments(student_id,course_id) VALUES(?,?)", [student, ml]);
    const cfg = { quick: 5, chapter: 5, full: 10, random: 5 };
    generateAutoQuizzes({ course_id: ml, user_id: teacher, config: cfg });
    generateAutoQuizzes({ course_id: web, user_id: teacher, config: cfg });
  });
  console.log("Seeded demo accounts: student@learnsphere.dev / student123, teacher@learnsphere.dev / teacher123");
}
