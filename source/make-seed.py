import json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
readings='''あけちひでみつ
あけちみつひで
あまごはるひさ
あまかすかげもち
あまりとらやす
あんどうちかすえ
あらきむらしげ
あさくらよしかげ
あたぎふゆやす
あざいながまさ
ばばのぶはる
ちさかかげちか
ちょうそかべもとちか
だてはるむね
だてまさむね
だててるむね
ふじばやしまさやす
ふくしままさのり
はちすかころく
はらとらたね
ひぐちかねとよ
ほんだまさのぶ
ほんだただかつ
ほんがんじけんにょ
ほりなおまさ
ほうじょうつなしげ
ほうじょううじやす
いちじょうのぶたつ
いまがわよしもと
いなばいってつ
いたがきのぶかた
じゅけいに
かきざきかげいえ
かにさいぞう
かとうきよまさ
かとうよしあき
かわだながちか
きちょう
こじまやたろう
こうりききよなが
くろだかんべえ
まえだけいじ
まえだとしいえ
まがらなおたか
まつ
まつだいらのぶやす
まつながひさひで
みやべけいじゅん
みよしじっきゅう
もりよしなり
もうりもとなり
もうりたかもと
ながのなりまさ
ないとうまさとよ
なんぶはるまさ
なりたかい
ねね
おぶとらまさ
おだのぶなが
おごう
おはつ
おいち
おかべもとのぶ
おおほうりつる
おおくぼながやす
おおたすけまさ
おおうちよしたか
さいとうよしたつ
さかいただつぐ
さかきばらやすまさ
さくまのぶもり
さなだまさゆき
さたけよししげ
さとみよしたか
せんとういん
しばたかついえ
しまづたかひさ
そごうかずまさ
そうまもりたね
すえはるかた
すわひめ
すずきさだゆう
たちばなどうせつ
たちばなぎんちよ
たかはしじょううん
たけだしんげん
たけなかはんべえ
とくがわいえやす
とよとみひでよし
つだかずなが
つまきひろこ
うえすぎけんしん
うらがみむねかげ
うさみさだみつ
やまがたまさかげ
やまもとかんすけ
ずいけいいん'''.splitlines()
rows=(root/'source/generals-original.tsv').read_text().strip().splitlines()[1:]
assert len(rows)==len(readings),(len(rows),len(readings))
low_input=[x.strip() for x in (root/'source/low-rate-names.txt').read_text().splitlines() if x.strip()]
# The supplied low-rate list uses 煕 for 妻木煕子; the existing master uses 熙.
alias={'妻木煕子':'妻木熙子'}
low={alias.get(name,name) for name in low_input}
generals=[]
for i,(row,reading) in enumerate(zip(rows,readings)):
    name,faction=row.split('\t')
    generals.append(dict(id=f'g-{i+1:03}',name=name,faction=faction,reading=reading,rate='low' if name in low else 'high',note=''))
assert low <= {g['name'] for g in generals}, sorted(low-{g['name'] for g in generals})
(root/'seed.js').write_text('// Names and factions: user-supplied TSV. Readings: editable sorting aid. Rates: user-supplied low-rate list; all other seeded S generals are high-rate.\nexport const seed = '+json.dumps(generals,ensure_ascii=False,indent=2)+';\n')
print(f'{len(generals)} generals generated: {sum(g["rate"]=="low" for g in generals)} low / {sum(g["rate"]=="high" for g in generals)} high')
