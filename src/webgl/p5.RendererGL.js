'use strict';

var p5 = require('../core/core');
require('./shader');
require('../core/p5.Renderer');
require('./p5.Matrix');
var uMVMatrixStack = [];

//@TODO should implement public method
//to override these attributes
var attributes = {
  alpha: true,
  depth: true,
  stencil: true,
  antialias: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false
};

/**
 * 3D graphics class
 * @class p5.RendererGL
 * @constructor
 * @extends p5.Renderer
 * @todo extend class to include public method for offscreen
 * rendering (FBO).
 *
 */
p5.RendererGL = function(elt, pInst, isMainCanvas) {
  p5.Renderer.call(this, elt, pInst, isMainCanvas);
  this._initContext();

  this.isP3D = true; //lets us know we're in 3d mode
  this.GL = this.drawingContext;
  //lights
  this.ambientLightCount = 0;
  this.directionalLightCount = 0;
  this.pointLightCount = 0;
  //camera
  this._curCamera = null;

  /**
   * model view, projection, & normal
   * matrices
   */
  this.uMVMatrix = new p5.Matrix();
  this.uPMatrix  = new p5.Matrix();
  this.uNMatrix = new p5.Matrix('mat3');
  //Geometry & Material hashes
  this.gHash = {};
  this.mHash = {};
  //Imediate Mode
  //default drawing is done in Retained Mode
  this.isImmediateDrawing = false;
  this.immediateMode = {};
  this.fill(255, 255, 255, 255);
  this.stroke(0, 0, 0, 255);
  this.pointSize = 5.0;//default point/stroke

  this.emptyTexture = null;
  this.curShader = null;

  return this;
};

p5.RendererGL.prototype = Object.create(p5.Renderer.prototype);

//////////////////////////////////////////////
// Setting
//////////////////////////////////////////////

p5.RendererGL.prototype._initContext = function() {
  try {
    this.drawingContext = this.canvas.getContext('webgl', attributes) ||
      this.canvas.getContext('experimental-webgl', attributes);
    if (this.drawingContext === null) {
      throw new Error('Error creating webgl context');
    } else {
      console.log('p5.RendererGL: enabled webgl context');
      var gl = this.drawingContext;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
  } catch (er) {
    throw new Error(er);
  }
};
//detect if user didn't set the camera
//then call this function below
p5.RendererGL.prototype._setDefaultCamera = function(){
  if(this._curCamera === null){
    var _w = this.width;
    var _h = this.height;
    this.uPMatrix = p5.Matrix.identity();
    var cameraZ = (this.height / 2) / Math.tan(Math.PI * 30 / 180);
    this.uPMatrix.perspective(60 / 180 * Math.PI, _w / _h,
                              cameraZ * 0.1, cameraZ * 10);
    this._curCamera = 'default';
  }
};

p5.RendererGL.prototype._update = function() {
  this.uMVMatrix = p5.Matrix.identity();
  this.translate(0, 0, -(this.height / 2) / Math.tan(Math.PI * 30 / 180));
  this.ambientLightCount = 0;
  this.directionalLightCount = 0;
  this.pointLightCount = 0;
};

/**
 * [background description]
 * @return {[type]} [description]
 */
p5.RendererGL.prototype.background = function() {
  var gl = this.GL;
  var _col = this._pInst.color.apply(this._pInst, arguments);
  var _r = (_col.levels[0]) / 255;
  var _g = (_col.levels[1]) / 255;
  var _b = (_col.levels[2]) / 255;
  var _a = (_col.levels[3]) / 255;
  gl.clearColor(_r, _g, _b, _a);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
};

//@TODO implement this
// p5.RendererGL.prototype.clear = function() {
//@TODO
// };

//////////////////////////////////////////////
// SHADER
//////////////////////////////////////////////

/**
 * [_initShaders description]
 * @param  {string} vertId [description]
 * @param  {string} fragId [description]
 * @return {[type]}        [description]
 */
p5.RendererGL.prototype._initShaders = function(vertId, fragId, isImmediateMode) {
  var shaderProgram = new p5.Shader(this, vertId, fragId);
  shaderProgram.init(); // make ready to use

  // cache for future use
  var mId = vertId + '|' + fragId;
  this.mHash[mId] = shaderProgram;

  return shaderProgram;
};


/**
 * Wrapper around gl.useProgram to make sure
 * we only switch shaders when neccessary
 */
p5.RendererGL.prototype._useShader = function(shaderProgram){
  if (shaderProgram === this.curShader) {
    return;
  }
  //shaderProgram.bind(); // TODO ? is this right?
  this.curShader = shaderProgram;
  this.curShader.useProgram();
  return shaderProgram;
};


//////////////////////////////////////////////
// GET CURRENT | for shader and color
//////////////////////////////////////////////
p5.RendererGL.prototype._getShader = function(vertId, fragId, isImmediateMode) {
  var mId = vertId + '|' + fragId;

  if(!this.materialInHash(mId)){
    this._initShaders(vertId, fragId, isImmediateMode);
    this.newShader = true;
  }
  this.curShaderId = mId;

  return this.mHash[this.curShaderId];
};

p5.RendererGL.prototype._getCurShaderId = function(){
  //if the shader ID is not yet defined
  if (this.drawMode !== 'fill' && this.curShaderId === undefined){
    //default shader: normalMaterial()
    this._getShader('normalVert', 'normalFrag');
  } else if (this.drawMode === 'fill'){
    // note that this._getShader will check if the shader already exists
    // by looking up the shader id (composed of vertexShaderId|fragmentShaderId)
    // in the material hash. If the material isn't found in the hash, it
    // creates a new one using this._initShaders--however, we'd like
    // use the cached version as often as possible, so we defer to this._getShader
    // here instead of calling this._initShaders directly.
    var newShader = this.curShader;
    if (this.isImmediateDrawing) {
      newShader = this._getShader('immediateVert', 'vertexColorFrag', true);
    } else {
      // we're not in immediate mode drawing,
      // but our shader is in the immediate mode fill.
      // need to change it to basic shading.
      if (this.curShaderId === 'immediateVert|vertexColorFrag' ||
        this.curShaderId === undefined) {
        newShader = this._getShader('normalVert', 'basicFrag', false);
      }
    }
    // this should be safe, but...
    this._useShader(newShader);
  }

  return this.curShaderId;
};

//////////////////////////////////////////////
// COLOR
//////////////////////////////////////////////
/**
 * Basic fill material for geometry with a given color
 * @method  fill
 * @param  {Number|Array|String|p5.Color} v1  gray value,
 * red or hue value (depending on the current color mode),
 * or color Array, or CSS color string
 * @param  {Number}            [v2] optional: green or saturation value
 * @param  {Number}            [v3] optional: blue or brightness value
 * @param  {Number}            [a]  optional: opacity
 * @return {p5}                the p5 object
 * @example
 * <div>
 * <code>
 * function setup(){
 *   createCanvas(100, 100, WEBGL);
 * }
 *
 * function draw(){
 *  background(0);
 *  fill(250, 0, 0);
 *  rotateX(frameCount * 0.01);
 *  rotateY(frameCount * 0.01);
 *  rotateZ(frameCount * 0.01);
 *  box(200, 200, 200);
 * }
 * </code>
 * </div>
 *
 * @alt
 * red canvas
 *
 */
p5.RendererGL.prototype.fill = function(v1, v2, v3, a) {
  var shaderProgram;
  //see material.js for more info on color blending in webgl
  var colors = this._applyColorBlend.apply(this, arguments);
  this.curFillColor = colors;
  this.drawMode = 'fill';
  if (this.isImmediateDrawing){
    shaderProgram = this._getShader('immediateVert','vertexColorFrag');
    this._useShader(shaderProgram);
  } else {
    shaderProgram = this._getShader('normalVert', 'basicFrag');
    this._useShader(shaderProgram);
    //RetainedMode uses a webgl uniform to pass color vals
    //in ImmediateMode, we want access to each vertex so therefore
    //we cannot use a uniform.
    shaderProgram.setUniform('uMaterialColor', colors);
  }
  return this;
};

p5.RendererGL.prototype.noFill = function() {
  var gl = this.GL;
  var shaderProgram = this._getShader('normalVert', 'basicFrag');
  this._useShader(shaderProgram);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  this.drawMode = 'wireframe';
  if(this.curStrokeColor) {
    this._setNoFillStroke();
  }
  return this;
};

p5.RendererGL.prototype.stroke = function(r, g, b, a) {
  var color = this._pInst.color.apply(this._pInst, arguments);
  var colorNormalized = color._array;
  this.curStrokeColor = colorNormalized;
  if(this.drawMode === 'wireframe') {
    this._setNoFillStroke();
  }
  return this;
};

p5.RendererGL.prototype._setNoFillStroke = function() {
  var shaderProgram = this.mHash[this.curShaderId];
  this._useShader(shaderProgram);
  this.curShader.setUniform('uMaterialColor', this.curStrokeColor);
};

/**
 * [strokeWeight description]
 * @param  {Number} pointSize stroke point size
 * @return {[type]}           [description]
 * @todo  strokeWeight currently works on points only.
 * implement on all wireframes and strokes.
 */
p5.RendererGL.prototype.strokeWeight = function(pointSize) {
  this.pointSize = pointSize;
  return this;
};
//////////////////////////////////////////////
// HASH | for material and geometry
//////////////////////////////////////////////

p5.RendererGL.prototype.geometryInHash = function(gId){
  return this.gHash[gId] !== undefined;
};

p5.RendererGL.prototype.materialInHash = function(mId){
  return this.mHash[mId] !== undefined;
};

/**
 * [resize description]
 * @param  {[type]} w [description]
 * @param  {[tyoe]} h [description]
 * @return {[type]}   [description]
 */
p5.RendererGL.prototype.resize = function(w,h) {
  var gl = this.GL;
  p5.Renderer.prototype.resize.call(this, w, h);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  // If we're using the default camera, update the aspect ratio
  if(this._curCamera === 'default') {
    this._curCamera = null;
    this._setDefaultCamera();
  }
};

/**
 * clears color and depth buffers
 * with r,g,b,a
 * @param {Number} r normalized red val.
 * @param {Number} g normalized green val.
 * @param {Number} b normalized blue val.
 * @param {Number} a normalized alpha val.
 */
p5.RendererGL.prototype.clear = function() {
  var gl = this.GL;
  gl.clearColor(arguments[0],
    arguments[1],
    arguments[2],
    arguments[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
};

/**
 * [translate description]
 * @param  {[type]} x [description]
 * @param  {[type]} y [description]
 * @param  {[type]} z [description]
 * @return {[type]}   [description]
 * @todo implement handle for components or vector as args
 */
p5.RendererGL.prototype.translate = function(x, y, z) {
  this.uMVMatrix.translate([x,-y,z]);
  return this;
};

/**
 * Scales the Model View Matrix by a vector
 * @param  {Number | p5.Vector | Array} x [description]
 * @param  {Number} [y] y-axis scalar
 * @param  {Number} [z] z-axis scalar
 * @return {this}   [description]
 */
p5.RendererGL.prototype.scale = function(x,y,z) {
  this.uMVMatrix.scale([x,y,z]);
  return this;
};

p5.RendererGL.prototype.rotate = function(rad, axis){
  this.uMVMatrix.rotate(rad, axis);
  return this;
};

p5.RendererGL.prototype.rotateX = function(rad) {
  this.rotate(rad, [1,0,0]);
  return this;
};

p5.RendererGL.prototype.rotateY = function(rad) {
  this.rotate(rad, [0,1,0]);
  return this;
};

p5.RendererGL.prototype.rotateZ = function(rad) {
  this.rotate(rad, [0,0,1]);
  return this;
};

/**
 * pushes a copy of the model view matrix onto the
 * MV Matrix stack.
 */
p5.RendererGL.prototype.push = function() {
  uMVMatrixStack.push(this.uMVMatrix.copy());
};

/**
 * [pop description]
 * @return {[type]} [description]
 */
p5.RendererGL.prototype.pop = function() {
  if (uMVMatrixStack.length === 0) {
    throw new Error('Invalid popMatrix!');
  }
  this.uMVMatrix = uMVMatrixStack.pop();
};

p5.RendererGL.prototype.resetMatrix = function() {
  this.uMVMatrix = p5.Matrix.identity();
  this.translate(0, 0, -800);
  return this;
};

// Text/Typography
// @TODO:
p5.RendererGL.prototype._applyTextProperties = function() {
  //@TODO finish implementation
  console.error('text commands not yet implemented in webgl');
};
module.exports = p5.RendererGL;
