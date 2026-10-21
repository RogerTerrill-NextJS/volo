import assert from 'node:assert/strict';
import {test} from 'node:test';
import {flightFeedHref,readFlightFeedSearch,formatFeedDeparture} from '../lib/flights/feed-view.ts';
import {formatDeparture} from '../lib/flights/time.ts';

test('feed navigation combines normalized filters across pages and drops the cursor when filters are reapplied',()=>{
 const search=readFlightFeedSearch({departureAirport:' kpao ',destinationAirport:' ksql ',dateFrom:'2030-06-01',dateTo:'2030-06-02',after:'cursor',owner_id:'private-canary'});
 assert.deepEqual(search.criteria,{departureAirport:'KPAO',destinationAirport:'KSQL',dateFrom:'2030-06-01',dateTo:'2030-06-02'});
 const next=flightFeedHref(search.criteria!, '{"id":"a&b"}');
 const url=new URL(next,'https://example.invalid');assert.equal(url.pathname,'/dashboard/flights');
 assert.deepEqual([...url.searchParams],[['departureAirport','KPAO'],['destinationAirport','KSQL'],['dateFrom','2030-06-01'],['dateTo','2030-06-02'],['after','{"id":"a&b"}']]);
 assert.ok(!flightFeedHref(search.criteria!).includes('after='));assert.ok(!JSON.stringify(search).includes('private-canary'));
});
test('feed search rejects repeated/malformed values while retaining only bounded editable fields',()=>{
 for(const query of [{departureAirport:['KPAO','KSQL']},{dateFrom:'2030-02-29'},{dateFrom:'2030-06-02',dateTo:'2030-06-01'}])assert.equal(readFlightFeedSearch(query).criteria,null);
 const search=readFlightFeedSearch({departureAirport:'x'.repeat(10000),after:['bad','cursor'],role:'private-canary'});
 assert.equal(search.criteria,null);assert.ok(search.values.departureAirport.length<=32);assert.ok(!JSON.stringify(search).includes('private-canary'));
 assert.equal(flightFeedHref({}),'/dashboard/flights');
});
test('feed displays departure-local time and offset for microsecond rows without weakening edit validation',()=>{
 const instant='2030-06-02T00:30:00.000001Z';
 const display=formatFeedDeparture(instant,'America/Los_Angeles');assert.ok(display);
 assert.equal(display.localDate,'2030-06-01');assert.equal(display.localTime,'17:30');assert.equal(display.utcOffset,'UTC-07:00');
 assert.equal(formatDeparture(instant,'America/Los_Angeles'),null,'Editing still refuses silently truncated fractional input');
 const earlier=formatFeedDeparture('2030-11-03T08:30:00.123456Z','America/Los_Angeles');
 const later=formatFeedDeparture('2030-11-03T09:30:00.123456Z','America/Los_Angeles');
 assert.equal(earlier?.localTime,'01:30');assert.equal(later?.localTime,'01:30');assert.notEqual(earlier?.utcOffset,later?.utcOffset);
 assert.equal(formatFeedDeparture('private-canary','UTC'),null);
});
