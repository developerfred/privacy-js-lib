var common = require("./common");
var Curve = new common.Elliptic('p256');

const P256Base = new common.BigInt('41058363725152142129326129780047268409114441015993725554835256314039467401291',10);
const CompressPointSize = 33;
const BigIntsize = 32;
const moduleP = common.BigInt.mont(Curve.curve.p.clone());
const moduleN = common.BigInt.mont(Curve.n.clone());
const exp4SqrtModP = Curve.curve.p.clone().addn(1).divn(4);// Fyi: To understanding that, read Tonelli–Shanks algorithm on Wikipedia.
function Compress(point){
    var res = new Uint8Array(CompressPointSize);
    var y = point.getY().toArray('be', BigIntsize);
    res[0]=2 + (y[BigIntsize-1] & 1 );
    res.set(point.getX().toArray('be', BigIntsize), 1);
    return res;
}
function Decompress(compPoint){
    x = new common.BigInt(compPoint.subarray(1), '10', 'be');
    var y = new common.BigInt(0);
    var basePoint = P256Base.clone();
    y = x.toRed(moduleP).redPow(new common.BigInt(3)).fromRed();
    y = y.toRed(moduleP).redSub(x.toRed(moduleP).redMul((new common.BigInt(3)).toRed(moduleP))).fromRed();
    y = y.toRed(moduleP).redAdd(basePoint.toRed(moduleP)).fromRed();
    y = y.toRed(moduleP).redPow(exp4SqrtModP).fromRed();
    var res = Curve.curve.point(x,y);
    return res;
}

var g1 = Curve.curve.point(Curve.g.getX(), Curve.g.getY());
var point = Decompress(Compress(Curve.g));

console.log(g1.getX().toString(), "_", g1.getY().clone().toString());
console.log(point.getX().toString(), "_", point.getY().clone().toString());//.add(point.getY()).toString());

