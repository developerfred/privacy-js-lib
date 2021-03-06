const bn = require('bn.js');
const { P256 } = require('../ec');
const { MAX_EXP } = require('./constants');
const { COMPRESS_POINT_SIZE, BIG_INT_SIZE } = require('../constants');
const { EncodeVectors, generateChallengeForAggRange } = require("./aggregaterangeparams");

const zeroPoint = P256.curve.point(0, 0);

class InnerProductWitness {
  constructor() {
    this.a = [];
    this.b = [];
    this.p = zeroPoint
  }

  prove(AggParam) {
    if (this.a.length !== this.b.length) {
      return null
    }
    let n = this.a.length;
    let a = new Array(n);
    let b = new Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = this.a[i];
      b[i] = this.b[i];
    }
    let p = P256.curve.point(this.p.getX(), this.p.getY());
    let G = new Array(n);
    let H = new Array(n);
    for (let i = 0; i < n; i++) {
      G[i] = P256.curve.point(AggParam.G[i].getX(), AggParam.G[i].getY());
      H[i] = P256.curve.point(AggParam.H[i].getX(), AggParam.H[i].getY());
    }
    let proof = new InnerProductProof();
    proof.l = [];
    proof.r = [];
    proof.p = this.p;
    console.time("While")
    while (n > 1) {
      let temp = n;
      console.time("While" + temp)
      let nPrime = n / 2;

      let cL = innerProduct(a.slice(0, nPrime), b.slice(nPrime,));
      let cR = innerProduct(a.slice(nPrime,), b.slice(0, nPrime));

      let L = EncodeVectors(a.slice(0, nPrime), b.slice(nPrime,), G.slice(nPrime,), H.slice(0, nPrime));
      L = L.add(AggParam.U.mul(cL));
      proof.l = proof.l.concat(L);
      let R = EncodeVectors(a.slice(nPrime,), b.slice(0, nPrime), G.slice(0, nPrime), H.slice(nPrime,));
      R = R.add(AggParam.U.mul(cR));
      proof.r = proof.r.concat(R);

      // calculate challenge x = hash(G || H || u || p ||  l || r)
      let x = generateChallengeForAggRange(AggParam, [p.compress(), L.compress(), R.compress()]);
      let xInverse = x.invm(P256.n);

      console.time("GPrime, HPrime: ")
      let GPrime = new Array(nPrime);
      let HPrime = new Array(nPrime);
      for (let i = 0; i < nPrime; i++) {
        GPrime[i] = G[i].mul(xInverse).add(G[i + nPrime].mul(x));
        HPrime[i] = H[i].mul(x).add(H[i + nPrime].mul(xInverse));
      }
      console.timeEnd("GPrime, HPrime: ")

      let xSquare = x.mul(x);
      let xSquareInverse = xSquare.invm(P256.n);
      let PPrime = L.mul(xSquare).add(p).add(R.mul(xSquareInverse));

      // calculate aPrime, bPrime
      console.time("calculate aPrime, bPrime:")
      let aPrime = new Array(nPrime);
      let bPrime = new Array(nPrime);
      for (let i = 0; i < nPrime; i++) {
        aPrime[i] = a[i].mul(x);
        aPrime[i] = aPrime[i].add(a[i + nPrime].mul(xInverse));
        aPrime[i] = aPrime[i].umod(P256.n);

        bPrime[i] = b[i].mul(xInverse);
        bPrime[i] = bPrime[i].add(b[i + nPrime].mul(x));
        bPrime[i] = bPrime[i].umod(P256.n);
      }
      console.timeEnd("calculate aPrime, bPrime:")

      a = aPrime;
      b = bPrime;
      p = P256.curve.point(PPrime.getX(), PPrime.getY());
      G = GPrime;
      H = HPrime;
      n = nPrime;

      console.timeEnd("While" + temp)
    }
    console.timeEnd("While")

    proof.a = a[0];
    proof.b = b[0];

    return proof
  }
}

class InnerProductProof {
  constructor() {
    this.l = [];
    this.r = [];
    this.a = new bn("0");
    this.b = new bn("0");
    this.p = P256.curve.point(0, 0);
  }

  bytes() {
    let l = 1 + COMPRESS_POINT_SIZE * (this.l.length + this.r.length) + 2 * BIG_INT_SIZE + COMPRESS_POINT_SIZE;
    let bytes = new Uint8Array(l);
    let offset = 0;
    bytes.set([this.l.length], offset);
    offset++;
    for (let i = 0; i < this.l.length; i++) {
      bytes.set(this.l[i].compress(), offset);
      offset += COMPRESS_POINT_SIZE;
    }
    for (let i = 0; i < this.r.length; i++) {
      bytes.set(this.r[i].compress(), offset);
      offset += COMPRESS_POINT_SIZE;
    }
    bytes.set(this.a.toArray("be", BIG_INT_SIZE), offset);
    offset += BIG_INT_SIZE;
    bytes.set(this.b.toArray("be", BIG_INT_SIZE), offset);
    offset += BIG_INT_SIZE;
    bytes.set(this.p.compress(), offset);
    return bytes
  }

  setBytes(bytes) {
    if (bytes.length === 0) {
      return null
    }
    let lenLArray = bytes[0];
    let offset = 1;
    this.l = new Array(lenLArray);
    for (let i = 0; i < lenLArray; i++) {
      this.l[i] = P256.decompress(bytes.slice(offset, offset + COMPRESS_POINT_SIZE));
      offset = offset + COMPRESS_POINT_SIZE;
    }
    this.r = new Array(lenLArray);
    for (let i = 0; i < lenLArray; i++) {
      this.r[i] = P256.decompress(bytes.slice(offset, offset + COMPRESS_POINT_SIZE));
      offset = offset + COMPRESS_POINT_SIZE;
    }
    this.a = new bn(bytes.slice(offset, offset + BIG_INT_SIZE), 16, "be");
    offset = offset + BIG_INT_SIZE;
    this.b = new bn(bytes.slice(offset, offset + BIG_INT_SIZE), 16, "be");
    offset = offset + BIG_INT_SIZE;
    this.p = P256.decompress(bytes.slice(offset, offset + COMPRESS_POINT_SIZE));
  }

  verify(AggParameter) {
    let p = this.p;
    let n = AggParameter.G.length;
    let G = new Array(n);
    let H = new Array(n);
    for (let i = 0; i < n; i++) {
      G[i] = AggParameter.G[i];
      H[i] = AggParameter.H[i];
    }
    let lLength = this.l.length;
    for (let i = 0; i < lLength; i++) {
      let nPrime = n / 2;
      let x = generateChallengeForAggRange(AggParameter, [p.compress(), this.l[i].compress(), this.r[i].compress()]);
      let xInverse = x.invm(P256.n);
      let GPrime = new Array(nPrime);
      let HPrime = new Array(nPrime);
      for (let i = 0; i < nPrime; i++) {
        GPrime[i] = G[i].mul(xInverse).add(G[i + nPrime].mul(x));
        HPrime[i] = H[i].mul(x).add(H[i + nPrime].mul(xInverse));
      }
      let xSquare = x.mul(x);
      let xSquareInverse = xSquare.invm(P256.n);
      // x^2 * l + P + xInverse^2 * r
      p = this.l[i].mul(xSquare).add(p).add(this.r[i].mul(xSquareInverse));
      G = GPrime;
      H = HPrime;
      n = nPrime;
    }
    let c = this.a.mul(this.b);
    let rightPoint = G[0].mul(this.a);
    rightPoint = rightPoint.add(H[0].mul(this.b));
    rightPoint = rightPoint.add(AggParameter.U.mul(c));
    if (rightPoint.getX().cmp(p.getX()) === 0 && rightPoint.getY().cmp(p.getY()) === 0) {
      return true;
    }
    return false;
  }
}

function innerProduct(a, b) {
  if (a.length !== b.length) {
    return null
  }

  let c = new bn("0", 10);
  for (let i = 0; i < a.length; i++) {
    let tmp = a[i].mul(b[i]);
    c = c.add(tmp);
  }
  c = c.umod(P256.n);
  return c;
}

function vectorAdd(v, w) {
  if (v.length !== w.length) {
    return null
  }
  let result = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i].add(w[i]);
    result[i] = result[i].umod(P256.n)
  }
  return result
}

function hadamardProduct(v, w) {
  if (v.length !== w.length) {
    //privacy.NewPrivacyErr(privacy.UnexpectedErr, errors.New("hadamardProduct: Uh oh! Arrays not of the same length"))
  }

  let result = new Array(v.length);

  for (let i = 0; i < v.length; i++) {
    result[i] = v[i].mul(w[i]);
    result[i] = result[i].umod(P256.n);
  }
  return result
}

function vectorAddScalar(v, s) {
  let result = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i].add(s);
    result[i] = result[i].umod(P256.n);
  }
  return result
}

function vectorMulScalar(v, s) {
  let result = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i].mul(s);
    result[i] = result[i].umod(P256.n);
  }
  return result
}

function powerVector(base, l) {
  let result = new Array(l.length);
  result[0] = new bn("1");
  for (let i = 1; i < l; i++) {
    result[i] = base.mul(result[i - 1]);
    result[i] = result[i].umod(P256.n);
  }
  return result;
}

function pad(l) {
  let deg = 0;
  while (l > 0) {
    if (l % 2 === 0) {
      deg++;
      l = l >> 1;
    } else {
      break;
    }
  }
  let i = 0;
  for (; ;) {
    if (Math.pow(2, i) < l) {
      i++;
    } else {
      l = Math.pow(2, i + deg);
      break;
    }
  }
  return l;

}
function estimateMultiRangeProofSize(nOutput){
  return parseInt((nOutput + 2*(Math.log2(MAX_EXP*pad(nOutput))) + 5)*COMPRESS_POINT_SIZE + 5* BIG_INT_SIZE + 2)
}

module.exports = {
  InnerProductWitness,
  pad,
  powerVector,
  vectorAddScalar,
  vectorMulScalar,
  vectorAdd,
  hadamardProduct,
  innerProduct,
  InnerProductProof,
  estimateMultiRangeProofSize
};
