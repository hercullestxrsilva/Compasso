import { describe,expect,it } from 'vitest';
import { defaultConfig,configSchema } from '../src/domain';
import { activeSeconds,beatsPerBar,buildTimeline,completedRounds,positionAt } from '../src/practice/timeline';
describe('musical practice timeline',()=>{
  it('accounts for preparation on all rounds and no final rest',()=>{const r=buildTimeline(defaultConfig);expect(r[0].practiceEnd-r[0].practiceStart).toBe(32);expect(r.at(-1)?.end).toBe(220);expect(activeSeconds(r,220)).toBe(160);expect(completedRounds(r,220)).toBe(5);});
  it('distinguishes compound meter beat units',()=>{expect(beatsPerBar({...defaultConfig,numerator:6,denominator:8,beatUnit:'dotted-quarter'})).toBe(2);expect(beatsPerBar({...defaultConfig,numerator:6,denominator:8,beatUnit:'eighth'})).toBe(6);});
  it('applies progressive tempo only between configured repetitions',()=>{const r=buildTimeline({...defaultConfig,increaseEvery:2,increaseBpm:10,targetBpm:75});expect(r.map(r=>r.bpm)).toEqual([60,60,70,70,75]);});
  it('does not lower initial tempo when cap is configured lower',()=>{expect(buildTimeline({...defaultConfig,bpm:100,targetBpm:60,increaseEvery:1}).every(r=>r.bpm===100)).toBe(true);});
  it('classifies phase transitions at exact boundaries',()=>{const r=buildTimeline(defaultConfig);expect(positionAt(r,0).phase).toBe('preparation');expect(positionAt(r,4).phase).toBe('practice');expect(positionAt(r,36).phase).toBe('rest');expect(positionAt(r,46).phase).toBe('preparation');expect(positionAt(r,220).phase).toBe('complete');});
  it('preserves exact second durations independent of the meter',()=>{const r=buildTimeline({...defaultConfig,mode:'seconds',seconds:17,bpm:73,repetitions:1});expect(r[0].practiceEnd-r[0].practiceStart).toBeCloseTo(17);expect(r[0].end).toBe(r[0].practiceEnd);});
  it('only counts active time for interrupted sessions',()=>{const r=buildTimeline(defaultConfig);expect(activeSeconds(r,2)).toBe(0);expect(activeSeconds(r,10)).toBe(6);expect(activeSeconds(r,40)).toBe(32);expect(completedRounds(r,35)).toBe(0);});
  it('validates unsafe values before scheduling',()=>{expect(configSchema.safeParse({...defaultConfig,bpm:0}).success).toBe(false);expect(configSchema.safeParse({...defaultConfig,repetitions:100000}).success).toBe(false);expect(configSchema.safeParse({...defaultConfig,denominator:3}).success).toBe(false);});
});
