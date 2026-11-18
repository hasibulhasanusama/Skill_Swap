export const SAMPLE_LIBRARY = [
  {
    "title": "Coding Detective — Foundations",
    "category": "coding",
    "difficulty": "Beginner",
    "notes": [
      "Use let for reassigned bindings; const prevents reassignment.",
      "JavaScript arrays start at index zero.",
      "A function supplies its result using return, not console.log."
    ],
    "questions": [
      {
        "prompt": "Find the error: const score = 0; score = score + 1;",
        "choices": [
          "Replace const with let",
          "Rename score",
          "Replace + with -",
          "No error"
        ],
        "answer": 0,
        "hint": "Does this binding change?",
        "explanation": "Use let for reassigned bindings; const prevents reassignment.",
        "page": 1
      },
      {
        "prompt": "const colours = [\"green\", \"gold\"]; The goal is to read the first colour. Which expression is correct?",
        "choices": [
          "colours[0]",
          "colours[1]",
          "colours[2]",
          "colours[-1]"
        ],
        "answer": 0,
        "hint": "The first index is zero.",
        "explanation": "JavaScript arrays start at index zero.",
        "page": 1
      },
      {
        "prompt": "function add(a,b) { console.log(a+b); } The caller needs the sum as a return value. What fixes it?",
        "choices": [
          "Use return a+b",
          "Remove the function name",
          "Change the variable name only",
          "Add another console.log"
        ],
        "answer": 0,
        "hint": "Printing and returning differ.",
        "explanation": "A function supplies its result using return, not console.log.",
        "page": 1
      }
    ]
  },
  {
    "title": "English Detective — Foundations",
    "category": "english",
    "difficulty": "Beginner",
    "notes": [
      "A third-person singular subject commonly uses -s or -es in the simple present.",
      "Use an before a vowel sound, for example an apple.",
      "Went is the past tense of go."
    ],
    "questions": [
      {
        "prompt": "Find the error: She go to class every day.",
        "choices": [
          "Replace go with goes",
          "Replace class with classes",
          "Remove every day",
          "No error"
        ],
        "answer": 0,
        "hint": "Check subject and verb agreement.",
        "explanation": "A third-person singular subject commonly uses -s or -es in the simple present.",
        "page": 1
      },
      {
        "prompt": "Find the error: I ate a apple.",
        "choices": [
          "Use an apple",
          "Use many apple",
          "Use am apple",
          "No error"
        ],
        "answer": 0,
        "hint": "Listen to the first sound in apple.",
        "explanation": "Use an before a vowel sound, for example an apple.",
        "page": 1
      },
      {
        "prompt": "Find the error: Yesterday I go to the library.",
        "choices": [
          "Replace go with went",
          "Replace go with goes",
          "Replace I with me",
          "No error"
        ],
        "answer": 0,
        "hint": "Yesterday indicates a past event.",
        "explanation": "Went is the past tense of go.",
        "page": 1
      }
    ]
  },
  {
    "title": "Design Detective — Foundations",
    "category": "design",
    "difficulty": "Beginner",
    "notes": [
      "An error must be communicated with text or an icon as well as colour.",
      "A visible form label should remain after the user starts typing.",
      "Button labels should describe the outcome of their action."
    ],
    "questions": [
      {
        "prompt": "A form indicates an error only by changing a border to red. What is missing?",
        "choices": [
          "A clear error message",
          "A thinner red border",
          "A random font",
          "Nothing"
        ],
        "answer": 0,
        "hint": "Do not rely on colour alone.",
        "explanation": "An error must be communicated with text or an icon as well as colour.",
        "page": 1
      },
      {
        "prompt": "An email input uses only placeholder text. What should be added?",
        "choices": [
          "A persistent Email label",
          "Another placeholder",
          "A random icon only",
          "Nothing"
        ],
        "answer": 0,
        "hint": "The label should stay visible.",
        "explanation": "A visible form label should remain after the user starts typing.",
        "page": 1
      },
      {
        "prompt": "A button saves a profile but says Click here. Which label is clearer?",
        "choices": [
          "Save profile",
          "Go",
          "Click",
          "Action"
        ],
        "answer": 0,
        "hint": "Name what the action does.",
        "explanation": "Button labels should describe the outcome of their action.",
        "page": 1
      }
    ]
  }
];
