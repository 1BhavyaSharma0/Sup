import assert from "node:assert/strict";
import { detectQuestions } from "../server/lib/extract.js";

const paper = `
Machine Learning - Unit Test 1

Section A: Multiple Choice Questions (1 mark each)
1. Which of the following is a supervised learning algorithm?
A) K-Means
B) Linear Regression
C) Apriori
D) DBSCAN
2. Overfitting occurs when a model: A) is too simple B) memorises noise in training data C) has no parameters D) is untrained
Answer: B

Section B: True or False
3. Supervised learning needs labelled data.
4. Clustering is a supervised technique. Answer: False

Section C: Short Answer Questions
5. Define overfitting. [2 marks]
Ans: When a model learns noise in the training data and fails to generalise.
6. What is Machine Learning?

Section D: Long Answer Questions
7. Explain Linear Regression with a suitable example. (5 marks)
8) Describe the bias-variance trade-off.

Answer Key
1. B  3. True
`;
const qs = detectQuestions(paper);
const by = n => qs.find(q => q.question_text.startsWith(n));
assert.equal(qs.length, 8, "8 questions detected");
const q1 = by("Which of the following"); assert.equal(q1.question_type, "mcq"); assert.equal(q1.options.length, 4);
assert.equal(q1.options.find(o => o.correct)?.label, "B", "answer key letter applied"); assert.equal(q1.answer_source, "extracted");
const q2 = by("Overfitting occurs"); assert.equal(q2.options.length, 3 + 1); assert.equal(q2.options.find(o => o.correct)?.label, "B");
assert.equal(by("Supervised learning needs").question_type, "true_false"); assert.equal(by("Supervised learning needs").answer_text, "True");
assert.equal(by("Clustering is").answer_text, "False"); assert.equal(by("Clustering is").question_text.includes("Answer"), false);
const q5 = by("Define overfitting"); assert.equal(q5.question_type, "short_answer"); assert.equal(q5.marks, 2); assert.match(q5.answer_text, /noise/);
assert.equal(by("What is Machine").answer_source, "missing");
assert.equal(by("Explain Linear").question_type, "long_answer"); assert.equal(by("Explain Linear").marks, 5);
assert.equal(by("Describe the bias").question_type, "long_answer");
console.log("extract tests passed:", qs.length, "questions");
