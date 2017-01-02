var canvas;
var audio;
var comboDiv;
var judgeDiv;
var scoreDiv;

var chart;
var lanes;
var laneNextNoteIndices;
const laneColors = [
  [],
  [1.0, 0.4, 0.4, 1.0],
  [0.0, 1.0, 1.0, 1.0],
  [0.2, 1.0, 0.2, 1.0],
  [0.0, 1.0, 1.0, 1.0],
  [0.0, 1.0, 1.0, 1.0],
  [0.2, 1.0, 0.2, 1.0],
  [0.0, 1.0, 1.0, 1.0],
  [1.0, 0.4, 0.4, 1.0],
  [1.0, 0.75, 0.0, 1.0]
];

// Game stuff
var combo = 0;
var judgmentQueue = [];
var judgeTime = -10.0;
var judgments = [0, 0, 0, 0, 0, 0];
var totalNotes;
var keydown = [false, false, false, false, false, false, false, false, false, false];
var keybeam = [-10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0];
var noteHeld = [false, false, false, false, false, false, false, false, false, false];
var holdStart = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
var holdProgress = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

// GL stuff
var gl;
var squareVerticesBuffer;
var squareVerticesColorBuffer;
var squareVerticesTexCoordBuffer;
var mvMatrix;
var shaderProgram;
var vertexPositionAttribute;
var vertexColorAttribute;
var vertexTexCoordAttribute;
var perspectiveMatrix;
var color;

// Textures
const TEXTURE_LOCATION = "notedrop/";
var texturesLoaded = 0;
var texNote;
var texHoldOuter;
var texHoldInner;
var texNote9;
var texHold9Outer;
var texHold9Inner;
var texGear;
var texKeybeam;

// Config
const TIMING_WINDOWS = [1.5/60.0, 3.5/60.0, 5.5/60.0, 7.5/60.0, 14.5/60.0, 14.5/60.0, 9.5/60.0];
const JUDGMENT_NAME = ["SUPER", "SUPER", "GREAT", "GOOD", "BAD", "BAD", "BREAK"];
const JUDGMENT_COLOR = ["#ffffff", "#ffffff", "#00ffff", "#00ff00", "#ff8000", "#ff8000", "#ff0000"]
const CHARGE_WINDOWS = [0.0, 3.5/29.0, 5.5/29.0, 7.5/29.0, 0.5, 1.0]; // CHARGE_WINDOWS[x] == TIMING_WINDOWS[x] / (2.0*TIMING_WINDOWS[BAD_INDEX]) except CHARGE_WINDOW[0] == 0.0
const PSUPER_INDEX = 0;
const GREAT_INDEX = 2;
const BAD_INDEX = 4;
const NB_BAD_INDEX = 5;
const BREAK_INDEX = 6;

const KEY_TO_LANE = {
  'a': 1,
  's': 2,
  'd': 3,
  'f': 4,
  'j': 5,
  'k': 6,
  'l': 7,
  ';': 8,
  ' ': 9
};

const LANE_HEIGHT = 14.0/8.0;
const LANE_BOTTOM = -6.0/8.0;
const LANE_POSITION = [
   0.0,
  -3.5/8.0,
  -2.5/8.0,
  -1.5/8.0,
  -0.5/8.0,
   0.5/8.0,
   1.5/8.0,
   2.5/8.0,
   3.5/8.0,
   0.0
];

class Note {
  constructor(time, lane, holdStart = false, holdNote = false, timeEnd = time) {
    this.time = time;
    this.lane = lane;
    this.holdStart = holdStart;
    this.holdNote = holdNote;
    this.timeEnd = timeEnd;
  }
}

function calculateScore(judgments, totalNotes) {
  const perfection = judgments[0];
  const supers = judgments[0]+judgments[1];
  const greats = judgments[2];

  const notescore = 2*supers + greats;
  const notescoreFactor = notescore/(2.0*totalNotes);

  return Math.floor(1000000*notescoreFactor) + perfection;
}

function checkPassiveJudgmentsUntil(time) {
  for (let i = 1; i <= 9; i++) {
    const lane = lanes[i];
    let j;
    for (j = laneNextNoteIndices[i]; j < lane.length; j++) {
      const note = lane[j];
      if (note.holdNote) {
        if (time >= note.timeEnd) {
          if (noteHeld[i]) {
            dropHold(i, note.timeEnd);
          }
          completeHold(i, note.timeEnd);
        } else {
          break;
        }
      } else if (note.time+TIMING_WINDOWS[BREAK_INDEX] < time) {
        prepareJudgment(BREAK_INDEX, i, time);
        if (note.holdStart) {
          holdProgress[i] = 0.0;
        }
      } else {
        break;
      }
    }
    laneNextNoteIndices[i] = j;
  }
}

function dropHold(laneNum, time) {
  const lane = lanes[laneNum];
  const nextNoteIndex = laneNextNoteIndices[laneNum];
  const note = lane[nextNoteIndex];
  const heldTime = Math.max(0, time-holdStart[laneNum]);
  noteHeld[laneNum] = false;
  holdProgress[laneNum] += heldTime / (note.timeEnd-note.time);
}

function completeHold(laneNum, time) {
  for (let i = 0; i < CHARGE_WINDOWS.length; i++) {
    const progress = holdProgress[laneNum];
    const chargeWindow = CHARGE_WINDOWS[i];
    if (progress >= 1.0-chargeWindow) {
      prepareJudgment(i, laneNum, time);
      laneNextNoteIndices[laneNum] += 1;
      break;
    }
  }
}

function prepareJudgment(judgmentIndex, laneNum, time) {
  judgmentQueue.push([judgmentIndex, laneNum, time]);
}

function completeJudgments() {
  // Sort by time, then by lane
  judgmentQueue.sort((lhs, rhs) => {
    if (lhs[2] == rhs[2]) {
      return lhs[1] - rhs[1];
    } else {
      return lhs[2] - rhs[2];
    }
  });

  for (let i = 0; i < judgmentQueue.length; i++) {
    let judge = judgmentQueue[i];
    let judgmentIndex = judge[0];
    let judgmentTime = judge[2];
    judgments[judgmentIndex] += 1;
    showJudgment(judgmentIndex, judgmentTime);
    if (judgmentIndex == BAD_INDEX || judgmentIndex == BREAK_INDEX) {
      combo = 0;
    } else if (judgmentIndex < BAD_INDEX) {
      combo += 1;
    }
    if (judgmentIndex <= GREAT_INDEX) {
      // Regen health
    } else if (judgmentIndex == BREAK_INDEX) {
      // Lose health
    } else if (judgmentIndex >= BAD_INDEX) {
      // Lose less health and can't die
    }
  }

  judgmentQueue = [];
}

function showJudgment(judgmentIndex, time) {
  judgeTime = time;
  judgeDiv.innerText = JUDGMENT_NAME[judgmentIndex];
  judgeDiv.style.color = JUDGMENT_COLOR[judgmentIndex];
  if (judgmentIndex == PSUPER_INDEX) {
    judgeDiv.style.textShadow = "0 0 1vh rgba(255,255,255,1)";
  } else {
    judgeDiv.style.textShadow = "0 0 1vh rgba(0,0,0,1)";
  }
}

//
// start
//
// Called when the canvas is created to get the ball rolling.
// Figuratively, that is. There's nothing moving in this demo.
//
function start() {
  canvas = document.getElementById("glcanvas");
  audio = document.createElement("AUDIO");
  comboDiv = document.getElementById("combo");
  judgeDiv = document.getElementById("judge");
  scoreDiv = document.getElementById("score");

  window.onkeydown = keyDownHandler;
  window.onkeyup = keyUpHandler;

  initWebGL(canvas);
  if (!gl) {
    alert("Couldn't set up WebGL.");
  }

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const texturePromise = initTextures();
  initShaders();
  initBuffers();

  const musicPromise = initMusic();
  initGame();
  const chartPromise = initChart();

  // Don't wait for the music to load, just hope it streams fast enough lol
  const resources = Promise.all([texturePromise, chartPromise]);
  resources.then(() => {
    setInterval(tick, 15);
    setTimeout(() => {
      audio.play();
      document.getElementById("dom").style.visibility = "visible";
    }, 15);
  });
}

function keyDownHandler(e) {
  const time = audio.currentTime;
  const laneNum = KEY_TO_LANE[e.key];
  if (!e.repeat && laneNum && !keydown[laneNum]) {
    // Check for breaks and charge completions
    // TODO: We could only check judgments in the keydown lane
    checkPassiveJudgmentsUntil(time);

    let judged = false;
    keydown[laneNum] = true;
    const lane = lanes[laneNum];
    const nextNoteIndex = laneNextNoteIndices[laneNum];
    const note = lane[nextNoteIndex];
    if (note) {
      if (!note.holdNote) {
        const timing = time - note.time;
        const early = (timing < 0.0); 
        const absTiming = Math.abs(timing);
        for (let i = 0; i < TIMING_WINDOWS.length; i++) {
          const timingWindow = TIMING_WINDOWS[i];
          if (absTiming <= timingWindow) {
            prepareJudgment(i, laneNum, time);
            if (note.holdStart) {
              // Start holding the charge segment
              noteHeld[laneNum] = true;
              holdStart[laneNum] = note.time;
              holdProgress[laneNum] = 0.0;
            }
            laneNextNoteIndices[laneNum] += 1;
            judged = true;
            break;
          }
        }
      } else {
        // Re-hold a dropped charge segment
        noteHeld[laneNum] = true;
        holdStart[laneNum] = time;
        judged = true;
      }
    }
    if (!judged) {
      // No note was hit - check against time of previous note if there was
      // one, and cause a BAD on it if in its timing window
      const note = lane[nextNoteIndex-1];
      if (note && !note.holdNote) {
        const timing = time - note.time;
        const absTiming = Math.abs(timing);
        if (absTiming <= TIMING_WINDOWS[NB_BAD_INDEX]) {
          prepareJudgment(NB_BAD_INDEX, laneNum, time);
        }
      }
    }
  }
}

function keyUpHandler(e) {
  const time = audio.currentTime;
  const laneNum = KEY_TO_LANE[e.key];
  if (laneNum && keydown[laneNum]) {
    keydown[laneNum] = false;
    keybeam[laneNum] = time;
    if (noteHeld[laneNum]) {
      // See if charge segment ended already
      checkPassiveJudgmentsUntil(time);
    }
    if (noteHeld[laneNum]) {
      dropHold(laneNum, time);
    }
  }
}

//
// initWebGL
//
// Initialize WebGL, returning the GL context or null if
// WebGL isn't available or could not be initialized.
//
function initWebGL() {
  gl = null;

  try {
    gl = canvas.getContext("experimental-webgl");
  }
  catch(e) {
  }

  // If we don't have a GL context, give up now

  if (!gl) {
    alert("Unable to initialize WebGL. Your browser may not support it.");
  }
}

function initTextures() {
  texGear = gl.createTexture();
  texNote = gl.createTexture();
  texHoldOuter = gl.createTexture();
  texHoldInner = gl.createTexture();
  texNote9 = gl.createTexture();
  texHold9Outer = gl.createTexture();
  texHold9Inner = gl.createTexture();
  texKeybeam = gl.createTexture();
  return Promise.all([
    loadTexture(texNote, TEXTURE_LOCATION+"art/note.png"),
    loadTexture(texHoldOuter, TEXTURE_LOCATION+"art/holdouter.png"),
    loadTexture(texHoldInner, TEXTURE_LOCATION+"art/holdinner.png"),
    loadTexture(texGear, TEXTURE_LOCATION+"art/gear.png"),
    loadTexture(texNote9, TEXTURE_LOCATION+"art/note9.png"),
    loadTexture(texHold9Outer, TEXTURE_LOCATION+"art/hold9outer.png"),
    loadTexture(texHold9Inner, TEXTURE_LOCATION+"art/hold9inner.png"),
    loadTexture(texKeybeam, TEXTURE_LOCATION+"art/keybeam.png")
  ]);
}

function loadTexture(texture, path) {
  return new Promise(function(resolve, reject) {
    const image = new Image();
    image.onload = function() {
      onTextureLoad(image, texture);
      resolve();
    }
    image.onerror = reject;
    image.crossOrigin = "Anonymous";
    image.src = path;
  });
}

function onTextureLoad(image, texture) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function initMusic() {
  return new Promise(function(resolve, reject) {
    audio.crossOrogin = "Anonymous";
    audio.src = TEXTURE_LOCATION+"tokimeki.mp3";
    audio.onload = resolve;
    audio.onerror = reject;
  });
}

function initGame() {
}

function initChart() {
  return new Promise(function(resolve, reject) {
    let file = new XMLHttpRequest();
    file.open("GET", TEXTURE_LOCATION+"chart.txt");
    file.onreadystatechange = function() {
      if (file.readyState != 4) {
        return;
      } else if (!(file.status === 200 || file.status == 0)) {
        reject();
      } else {
        chart = [];

        const lines = file.responseText.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("N")) {
            const components = line.split(",");
            const timeMs = components[1];
            const lane = components[2];
            chart.push(new Note(timeMs/1000.0, lane));
          } else if (line.startsWith("H")) {
            const components = line.split(",");
            const timeStartMs = components[1];
            const timeEndMs = components[2];
            const lane = components[3];
            chart.push(new Note(timeStartMs/1000.0, lane, true));
            chart.push(new Note(timeStartMs/1000.0, lane, false, true, timeEndMs/1000.0));
          }
        }
        /*
        chart.push(new Note(1.6, 2, true));
        chart.push(new Note(1.6, 7, true));
        chart.push(new Note(1.6, 2, false, true, 11.2));
        chart.push(new Note(1.6, 7, false, true, 11.2));

        chart.push(new Note(12.8, 2));
        chart.push(new Note(13.2, 3));
        chart.push(new Note(13.6, 4));
        chart.push(new Note(14.0, 5));
        chart.push(new Note(14.4, 6));
        chart.push(new Note(14.8, 7));
        */

        lanes = [[], [], [], [], [], [], [], [], [], []];
        for (let i = 0; i < chart.length; i++) {
          const note = chart[i];
          lanes[note.lane].push(note);
        }

        laneNextNoteIndices = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

        resolve();
      }
    }
    file.send();
  });
}

//
// initBuffers
//
// Initialize the buffers we'll need. For this demo, we just have
// one object -- a simple two-dimensional square.
//
function initBuffers() {
  var vertices = [
    1.0,  1.0,  0.0,
    -1.0, 1.0,  0.0,
    1.0,  -1.0, 0.0,
    -1.0, -1.0, 0.0
  ];
  squareVerticesBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, squareVerticesBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  var colors = [
    1.0,  1.0,  1.0,  1.0,
    1.0,  1.0,  1.0,  1.0,
    1.0,  1.0,  1.0,  1.0,
    1.0,  1.0,  1.0,  1.0
  ];
  squareVerticesColorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, squareVerticesColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

  var texCoords = [
    0.0, 0.0,
    1.0, 0.0,
    0.0, 1.0,
    1.0, 1.0
  ];
  squareVerticesTexCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, squareVerticesTexCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
}

function tick() {
  tickGame();
  const time = audio.currentTime;
  drawCanvas(time);
  drawDOM(time);
}

function tickGame() {
  const time = audio.currentTime;
  checkPassiveJudgmentsUntil(time);
  completeJudgments();
}

function drawCanvas(time) {

  gl.clear(gl.COLOR_BUFFER_BIT);

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  let ratio = canvas.clientWidth / canvas.clientHeight;
  perspectiveMatrix = makeOrtho(-1.0*ratio, ratio, -1.0, 1.0, 1.0, -1.0);

  gl.bindBuffer(gl.ARRAY_BUFFER, squareVerticesBuffer);
  gl.vertexAttribPointer(vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, squareVerticesColorBuffer);
  gl.vertexAttribPointer(vertexColorAttribute, 4, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, squareVerticesTexCoordBuffer);
  gl.vertexAttribPointer(vertexTexCoordAttribute, 2, gl.FLOAT, false, 0, 0);

  const drawOrder = [9, 1, 2, 3, 4, 5, 6, 7, 8];
  drawGear();
  for (let i = 0; i < drawOrder.length; i++) {
    const laneNum = drawOrder[i];
    if (keydown[laneNum]) {
      drawKeybeam(laneNum, 1.0);
    } else {
      const alpha = 1.0 - 4.0*(time-keybeam[laneNum]);
      if (alpha > 0.0) {
        drawKeybeam(laneNum, alpha);
      }
    }
  }
  for (let i = 0; i < drawOrder.length; i++) {
    const laneNum = drawOrder[i];
    const lane = lanes[laneNum];
    for (let j = laneNextNoteIndices[laneNum]; j < lane.length; j++) {
      const note = lane[j];
      if (note.time >= time+1.0) {
        break;
      }
      if (!note.holdStart && !note.holdNote) {
        drawNote(note.lane, note.time-time);
      } else if (note.holdNote) {
        drawHold(note.lane, note.time-time, note.timeEnd-time, (j == laneNextNoteIndices[laneNum] && noteHeld[note.lane]));
      }
    }
  }
}

function drawDOM(time) {
  comboDiv.innerText = combo;
  judgeDiv.style.opacity = Math.min(Math.max(0.0, 4.0 - 4.0*(time-judgeTime)), 1.0);
  scoreDiv.innerText = calculateScore(judgments, chart.length);
}

function drawGear() {
  color = [1.0, 1.0, 1.0, 1.0];
  loadIdentity();
  setMatrixUniforms();
  bindTexture(texGear);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawNote(lane, y) {
  y *= 1.4;
  if (lane == 9) {
    color = laneColors[lane];
    loadIdentity();
    mvTranslate([LANE_POSITION[lane], Math.max(0.0, LANE_HEIGHT*y)+LANE_BOTTOM, 0.0]);
    mvScale([8.0/16.0, 0.5/16.0, 1.0]);
    mvTranslate([0.0, 0.5, 0.0]);
    setMatrixUniforms();
    bindTexture(texNote9);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    color = laneColors[lane];
    loadIdentity();
    mvTranslate([LANE_POSITION[lane], Math.max(0.0, LANE_HEIGHT*y)+LANE_BOTTOM, 0.0]);
    mvScale([1.0/16.0, 0.25/16.0, 1.0]);
    mvTranslate([0.0, 1.0, 0.0]);
    setMatrixUniforms();
    bindTexture(texNote);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function drawHold(lane, y1, y2, holding) {
  y1 *= 1.4;
  y2 *= 1.4;
  const lower = Math.max(0.0, LANE_HEIGHT*y1)+LANE_BOTTOM;
  const upper = Math.max(0.0, LANE_HEIGHT*y2)+LANE_BOTTOM;

  color = laneColors[lane];
  if (!holding) {
    color = [color[0]*0.5, color[1]*0.5, color[2]*0.5, 1.0];
  }
  if (lane == 9) {
    loadIdentity();
    mvTranslate([LANE_POSITION[lane], lower, 0.0]);
    mvScale([8.0/16.0, (upper-lower)/2.0, 1.0]);
    mvTranslate([0.0, 1.0, 0.0]);
    setMatrixUniforms();
    bindTexture(texHold9Inner);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    color = laneColors[lane];
    loadIdentity();
    mvTranslate([LANE_POSITION[lane], lower, 0.0]);
    mvScale([8.0/16.0, 0.5/16.0, 1.0]);
    mvTranslate([0.0, 0.5, 0.0]);
    setMatrixUniforms();
    bindTexture(texHold9Outer);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    loadIdentity();
    mvTranslate([LANE_POSITION[lane], lower, 0.0]);
    mvScale([1.0/16.0, (upper-lower)/2.0, 1.0]);
    mvTranslate([0.0, 1.0, 0.0]);
    setMatrixUniforms();
    bindTexture(texHoldInner);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    color = laneColors[lane];
    loadIdentity();
    mvTranslate([LANE_POSITION[lane], lower, 0.0]);
    mvScale([1.0/16.0, 0.25/16.0, 1.0]);
    mvTranslate([0.0, 1.0, 0.0]);
    setMatrixUniforms();
    bindTexture(texHoldOuter);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function drawKeybeam(lane, alpha) {
  color = [1.0, 1.0, 1.0, 0.5*alpha];
  loadIdentity();
  mvTranslate([LANE_POSITION[lane], LANE_BOTTOM, 0.0]);
  if (lane == 9) {
    mvScale([6.0/16.0, 0.25*LANE_HEIGHT/4.0, 1.0]);
  } else {
    mvScale([1.0/16.0, LANE_HEIGHT/4.0, 1.0]);
  }
  mvTranslate([0.0, 1.0, 0.0]);
  setMatrixUniforms();
  bindTexture(texKeybeam);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

//
// initShaders
//
// Initialize the shaders, so WebGL knows how to light our scene.
//
function initShaders() {
  var fragmentShader = getShader(gl, "shader-fs");
  var vertexShader = getShader(gl, "shader-vs");

  // Create the shader program

  shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  // If creating the shader program failed, alert

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    alert("Unable to initialize the shader program: " + gl.getProgramInfoLog(shader));
  }

  gl.useProgram(shaderProgram);

  vertexPositionAttribute = gl.getAttribLocation(shaderProgram, "aVertexPosition");
  gl.enableVertexAttribArray(vertexPositionAttribute);

  vertexColorAttribute = gl.getAttribLocation(shaderProgram, "aVertexColor");
  gl.enableVertexAttribArray(vertexColorAttribute);

  vertexTexCoordAttribute = gl.getAttribLocation(shaderProgram, "aTexCoord");
  gl.enableVertexAttribArray(vertexTexCoordAttribute);
}

//
// getShader
//
// Loads a shader program by scouring the current document,
// looking for a script with the specified ID.
//
function getShader(gl, id) {
  var shaderScript = document.getElementById(id);

  // Didn't find an element with the specified ID; abort.

  if (!shaderScript) {
    return null;
  }

  // Walk through the source element's children, building the
  // shader source string.

  var theSource = "";
  var currentChild = shaderScript.firstChild;

  while(currentChild) {
    if (currentChild.nodeType == 3) {
      theSource += currentChild.textContent;
    }

    currentChild = currentChild.nextSibling;
  }

  // Now figure out what type of shader script we have,
  // based on its MIME type.

  var shader;

  if (shaderScript.type == "x-shader/x-fragment") {
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  } else if (shaderScript.type == "x-shader/x-vertex") {
    shader = gl.createShader(gl.VERTEX_SHADER);
  } else {
    return null;  // Unknown shader type
  }

  // Send the source to the shader object

  gl.shaderSource(shader, theSource);

  // Compile the shader program

  gl.compileShader(shader);

  // See if it compiled successfully

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
    return null;
  }

  return shader;
}

//
// Matrix utility functions
//

function loadIdentity() {
  mvMatrix = Matrix.I(4);
}

function multMatrix(m) {
  mvMatrix = mvMatrix.x(m);
}

function mvTranslate(v) {
  multMatrix(Matrix.Translation($V([v[0], v[1], v[2]])).ensure4x4());
}

function mvScale(v) {
  multMatrix(Matrix.Scale($V([v[0], v[1], v[2]])).ensure4x4());
}

function setMatrixUniforms() {
  var pUniform = gl.getUniformLocation(shaderProgram, "uPMatrix");
  gl.uniformMatrix4fv(pUniform, false, new Float32Array(perspectiveMatrix.flatten()));

  var mvUniform = gl.getUniformLocation(shaderProgram, "uMVMatrix");
  gl.uniformMatrix4fv(mvUniform, false, new Float32Array(mvMatrix.flatten()));

  var cUniform = gl.getUniformLocation(shaderProgram, "vColorTransform");
  gl.uniform4fv(cUniform, new Float32Array(color));
}

function bindTexture(texture) {
  var sUniform = gl.getUniformLocation(shaderProgram, "uSampler");
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(sUniform, 0);
}
