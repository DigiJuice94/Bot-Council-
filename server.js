const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const PAGE = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');

const DEFAULT_OPPORTUNITIES = [
  {
    id:'boxncase-free-review', brand:'BoxNCase', category:'free_product', type:'FREE PRODUCT + AFFILIATE', fit:96,
    shortDescription:'Specialty food and beverage samples built for honest unboxings and reviews.',
    website:'https://www.boxncase.com/', productUrl:'https://www.boxncase.com/', contactUrl:'https://creator.boxncase.com/', contactMethod:'Apply through the official BoxNCase Creator program.',
    compensation:'Complimentary product samples + creator commissions; monthly payouts are advertised by the program.',
    partnership:'DTL receives specialty food or beverage products, records an honest taste-test/unboxing/review, then can use trackable creator links if the product is a real fit.',
    fitReason:'DTL already produces food and product-reaction content, so the product can become natural entertainment instead of a forced ad.',
    sourceUrl:'https://creator.boxncase.com/', sourceFreshness:'Verified Sep 15, 2026', status:'HIGH PRIORITY',
    emailTemplate:`Subject: Down The Line x BoxNCase — Product Review Collaboration\n\nHi BoxNCase Creator Team,\n\nI’m reaching out from Down The Line Podcast. We create entertainment-driven food and product reaction content across TikTok, Instagram, and YouTube, and BoxNCase looks like a strong fit for an honest unboxing/taste-test segment.\n\nWe’d love to explore receiving a product selection for consideration in an honest review. If you also have paid creator opportunities available, we’d be interested in discussing those first; otherwise we’re open to the creator/affiliate structure listed in your program.\n\nWe never promise a positive review or guaranteed coverage, but we do make engaging, personality-driven content and would clearly disclose any gifted or commercial relationship.\n\nHappy to send our current verified DTL performance snapshot and relevant food-content examples.\n\nBest,\nDown The Line Podcast`
  },
  {
    id:'kalmes-free-review', brand:'Kalmes Foods', category:'free_product', type:'FREE PRODUCT + AFFILIATE', fit:92,
    shortDescription:'Seasonings and breading mixes with free samples for approved creators.',
    website:'https://kalmesfoods.com/', productUrl:'https://kalmesfoods.com/pages/for-influencers', contactUrl:'https://kalmesfoods.com/pages/for-influencers', contactMethod:'Apply through the Kalmes Foods Creator Program / Shopify Collabs form.',
    compensation:'Free product samples + 15% commission on sales through the creator code/link.',
    partnership:'DTL can build a before-vs-after food test, seasoning challenge, or honest recipe/reaction segment around the samples and optionally use the creator code if viewers want the product.',
    fitReason:'The format is easy to make entertaining and measurable: cook the same food with and without the product, then give a real verdict.',
    sourceUrl:'https://kalmesfoods.com/pages/for-influencers', sourceFreshness:'Verified Sep 15, 2026', status:'READY TO PITCH',
    emailTemplate:`Subject: Creator Collaboration — Down The Line Podcast x Kalmes Foods\n\nHi Kalmes Foods Team,\n\nI’m reaching out from Down The Line Podcast. Our food-review content is built around honest reactions and simple tests that viewers can immediately understand. Your seasoning and breading products would work well for a side-by-side taste test or “does this actually make it better?” segment.\n\nWe’d be interested in joining your creator program and receiving samples for consideration in an honest review. If there is any paid creator budget available for a stronger dedicated integration, we’d also be happy to discuss that.\n\nAny gifted/affiliate relationship would be clearly disclosed, and we do not promise a positive review.\n\nBest,\nDown The Line Podcast`
  },
  {
    id:'bakeful-sponsor', brand:'Bakeful', category:'sponsor', type:'PAID / GIFTED CREATOR COLLAB', fit:94,
    shortDescription:'Snack brand actively offering paid and gifted creator collaborations, UGC, and launch campaigns.',
    website:'https://bakefulbunch.com/', productUrl:'https://bakefulbunch.com/', contactUrl:'https://bakefulbunch.com/', contactMethod:'Use the Bakeful Creator application on the official Bakeful Bunch page.',
    compensation:'Official creator track advertises paid and gifted collaborations, UGC, and launch campaigns. Creator applications are reviewed monthly.',
    partnership:'A paid DTL snack taste-test, launch reaction, ranking challenge, or short-form UGC package using Bakeful products without changing the show into a traditional commercial.',
    fitReason:'Snack testing is already native to DTL’s content style and can produce both a main segment and multiple short clips.',
    sourceUrl:'https://bakefulbunch.com/', sourceFreshness:'Verified Sep 15, 2026', status:'HIGH PRIORITY',
    emailTemplate:`Subject: Paid Creator Collaboration — Down The Line Podcast x Bakeful\n\nHi Bakeful Creator Team,\n\nI’m reaching out from Down The Line Podcast. We create personality-driven food and snack reactions across TikTok, Instagram, and YouTube, and Bakeful’s paid/gifted creator track looks very aligned with the type of content we already make.\n\nWe’d love to discuss a paid creator collaboration built around an honest taste test, ranking challenge, or new-flavor reaction. We can also create short-form cuts from the same recording for additional social use if that matches your campaign needs.\n\nWe keep reviews honest, disclose commercial relationships, and never promise a positive outcome. I can send our current verified DTL food-content performance snapshot and examples.\n\nBest,\nDown The Line Podcast`
  },
  {
    id:'calywire-sponsor', brand:'Calywire Creator Network', category:'sponsor', type:'PAID + GIFTED CAMPAIGNS', fit:88,
    shortDescription:'Paid and gifted creator campaigns for Korean and Japanese brands entering the U.S.',
    website:'https://calywire.com/creators/', productUrl:'https://calywire.com/creators/', contactUrl:'https://calywire.com/creators/', contactMethod:'Apply through the official Calywire Creator Network application.',
    compensation:'Free products to keep + paid partnerships + affiliate commissions; no follower minimum is advertised.',
    partnership:'DTL can match with food, lifestyle, or culture products from Korean/Japanese brands and create review/reaction content under a clearly defined campaign brief.',
    fitReason:'The mix of food reviews, entertainment, anime/manga interest, and reaction content gives DTL multiple ways to match incoming Asian consumer brands.',
    sourceUrl:'https://calywire.com/creators/', sourceFreshness:'Verified Sep 15, 2026', status:'NEW',
    emailTemplate:`Subject: Down The Line Podcast — Creator Network Application\n\nHi Calywire Team,\n\nI’m reaching out from Down The Line Podcast. We cover entertainment, food/product reactions, anime/manga, gaming, sports, and trending culture across TikTok, Instagram, and YouTube.\n\nYour paid and gifted campaigns for Korean and Japanese brands look like a strong fit for our audience and content mix. We’re especially interested in products that can be tested or reacted to naturally on camera.\n\nWe’d love to be considered for relevant paid campaigns first, while remaining open to gifted and affiliate opportunities when the product fit is strong. Any commercial relationship would be clearly disclosed and all reviews remain honest.\n\nBest,\nDown The Line Podcast`
  },
  {
    id:'tokyotreat-affiliate', brand:'TokyoTreat', category:'affiliate', type:'AFFILIATE + PRODUCT BOX', fit:95,
    shortDescription:'Japanese snack subscription box with product box + per-conversion affiliate payouts.',
    website:'https://tokyotreat.com/', productUrl:'https://tokyotreat.com/', contactUrl:'https://tokyotreat.com/affiliate', contactMethod:'Apply through the TokyoTreat affiliate inquiry form.',
    compensation:'Affiliate page currently lists $5 per conversion at Tier 1, a 30-day attribution window, monthly PayPal payouts, and a TokyoTreat box for approved affiliates.',
    partnership:'DTL receives a Japanese snack box, creates a themed taste test/ranking, and uses the unique affiliate link if viewers want to subscribe.',
    fitReason:'Japanese snacks can bridge DTL’s food content with its anime/manga audience, making this more relevant than a generic affiliate placement.',
    sourceUrl:'https://tokyotreat.com/affiliate', sourceFreshness:'Verified Sep 15, 2026', status:'READY TO PITCH',
    emailTemplate:`Subject: TokyoTreat x Down The Line Podcast\n\nHi TokyoTreat Team,\n\nI’m reaching out from Down The Line Podcast. We create food reactions alongside anime/manga and entertainment content, which makes TokyoTreat a natural crossover for our audience.\n\nWe’d love to join the affiliate program and build an honest Japanese snack-box taste test/ranking segment around a TokyoTreat box. We would clearly disclose the affiliate relationship and only recommend the product based on our real experience.\n\nIf there are paid creator campaign opportunities available beyond the standard affiliate program, we’d also be interested in discussing those.\n\nBest,\nDown The Line Podcast`
  },
  {
    id:'ooni-affiliate', brand:'Ooni', category:'affiliate', type:'AFFILIATE / CREATOR', fit:82,
    shortDescription:'Pizza-oven brand with an official creator/affiliate program and product-launch access.',
    website:'https://ooni.com/', productUrl:'https://ooni.com/', contactUrl:'https://ooni.com/pages/become-an-affiliate', contactMethod:'Apply via Ooni’s official Affiliates and Creators page.',
    compensation:'Affiliate commission is offered; the program also advertises early product-launch access, event invites, and promotions. Exact commission rate is not publicly stated on the page.',
    partnership:'A DTL pizza cook-off, frozen-vs-Ooni comparison, or “is this worth it?” episode can support affiliate links without losing the honest-review format.',
    fitReason:'DTL already makes food/review content, though the product is higher-ticket and requires more production than snack-based partnerships.',
    sourceUrl:'https://ooni.com/pages/become-an-affiliate', sourceFreshness:'Verified Sep 15, 2026', status:'NEW',
    emailTemplate:`Subject: Ooni Creator / Affiliate Collaboration — Down The Line Podcast\n\nHi Ooni Team,\n\nI’m reaching out from Down The Line Podcast. We create entertainment-driven food and product review content and would love to explore Ooni’s creator/affiliate program.\n\nA natural fit for us would be an honest pizza challenge, comparison, or “is it worth it?” episode using Ooni, with short-form clips cut from the same segment.\n\nWe’d be interested in any paid creator opportunities first, and are also open to affiliate participation when the product and campaign fit our audience. Any commercial relationship would be clearly disclosed.\n\nBest,\nDown The Line Podcast`
  }
];

const DEFAULT_TRENDS = {
  lastUpdated:'2026-09-15T22:25:00Z',
  hashtagSource:'TikTok Creative Center public U.S. snapshots. Trend tags rotate quickly; use only when the actual post is relevant.',
  keywordSource:'YouTube search-trend snapshot from vidIQ, updated Sep 13, 2026. These are discovery signals, not guaranteed views.',
  hashtags:[
    {term:'#dollyparton',metric:'2.4B views',context:'News & Entertainment · observed in current public Creative Center snapshot'},
    {term:'#haydenpanettiere',metric:'807M views',context:'News & Entertainment · current public Creative Center snapshot'},
    {term:'#september',metric:'172.7M views',context:'News & Entertainment · U.S. 7-day snapshot'},
    {term:'#worththesearch',metric:'122.2M views',context:'Broad trend · current public Creative Center snapshot'},
    {term:'#livecanbeeasy',metric:'37.2M views',context:'News & Entertainment · U.S. 7-day snapshot'}
  ],
  keywords:[
    {term:'real madrid vs inter milan',metric:'+12,281%',context:'YouTube search growth · sports'},
    {term:'wolverine review',metric:'+7,642%',context:'YouTube search growth · movies / reviews'},
    {term:'champions league highlights',metric:'+6,379%',context:'YouTube search growth · sports'},
    {term:'blizzcon 2026',metric:'+5,981%',context:'YouTube search growth · gaming'},
    {term:'godzilla minus zero trailer',metric:'+4,898%',context:'YouTube search growth · movies / entertainment'}
  ]
};

const DEFAULT_ANALYSIS_30M = {
  window:'Last 30 minutes', updatedAt:null,
  analyzed:'No completed 30-minute worker summary has been pushed yet. The dashboard is ready to receive the next opportunity, trend, performance, and content-analysis cycle.',
  doingWell:'Waiting for current-cycle evidence before calling anything a strength.',
  doingWrong:'Waiting for current-cycle evidence before labeling a weakness.',
  improve:'Once the next cycle finishes, the system will convert the evidence into one or two concrete changes to test next.'
};

const SEED_STATE = {
  meta:{project:'Down The Line',updatedAt:'2026-09-15T22:25:00Z',mode:'seed'},
  platforms:[
    {id:'tiktok',name:'TikTok',handle:'@down.the.line.pod',followers:913,followerTarget:10000,metricLabel:'Eligible views / 30d',metricValue:null,metricTarget:100000,status:'Tracking public count',note:'Creator Rewards private eligible-view data requires authorized analytics.'},
    {id:'instagram',name:'Instagram',handle:'@down.the.line.pod',followers:100,followerTarget:500,metricLabel:'Nearest native unlock',metricValue:100,metricTarget:500,status:'Gifts path',note:'This is one Instagram monetization path, not a universal threshold.'},
    {id:'youtube',name:'YouTube',handle:'@Down.The.Line.Podcast',followers:1540,followerTarget:1000,metricLabel:'Qualified watch hours / 365d',metricValue:null,metricTarget:4000,status:'Subscriber goal cleared',note:'Qualified watch hours remain DATA NOT CONNECTED until an authorized source provides them.'}
  ],
  agents:[
    {id:'hook',name:'HOOK',role:'Hook Specialist',initials:'HK',status:'Watching',current:'Opening strength across recent clips',confidence:82,finding:'Make the premise understandable before the viewer has time to scroll.'},
    {id:'retention',name:'RETENTION',role:'Retention Specialist',initials:'RT',status:'Analyzing',current:'Pacing and payoff timing',confidence:76,finding:'Move the payoff forward when setup stops adding value.'},
    {id:'content',name:'CONTENT',role:'Content Specialist',initials:'CT',status:'Watching',current:'Topic and standalone clip value',confidence:79,finding:'Prioritize moments that work without needing full-episode context.'},
    {id:'packaging',name:'PACKAGING',role:'Packaging Specialist',initials:'PK',status:'Analyzing',current:'Titles, captions and thumbnails',confidence:81,finding:'Packaging should make one clear promise.'},
    {id:'performance',name:'PERFORMANCE',role:'Performance Specialist',initials:'PF',status:'Tracking',current:'Cross-platform public performance',confidence:88,finding:'Build a verified baseline before declaring a format a winner.'},
    {id:'discovery',name:'DISCOVERY',role:'Discovery & Experiment Specialist',initials:'DS',status:'Testing',current:'Posting windows and format variables',confidence:71,finding:'Change one major variable at a time.'},
    {id:'algorithm',name:'ALGORITHM',role:'Algorithm & Trend Intelligence',initials:'AL',status:'Researching',current:'Platform guidance and current trends',confidence:77,finding:'Treat trends as time-sensitive opportunities.'},
    {id:'competitive',name:'COMPETITIVE',role:'Competitive Pattern Specialist',initials:'CP',status:'Researching',current:'Winning patterns in DTL categories',confidence:74,finding:'Adapt repeatable structures without copying creators.'},
    {id:'goal',name:'GOAL',role:'Goal & Monetization Specialist',initials:'GL',status:'Tracking',current:'Monetization bottlenecks',confidence:90,finding:'Qualified watch-hour data is still the missing YouTube metric.'},
    {id:'opportunity',name:'OPPORTUNITY',role:'Revenue Opportunity Scout',initials:'OP',status:'Scouting',current:'Sponsors, affiliates and product seeding',confidence:75,finding:'Use verified category-specific DTL analytics in pitches.'}
  ],
  opportunities:DEFAULT_OPPORTUNITIES,
  trends:DEFAULT_TRENDS,
  analysis30m:DEFAULT_ANALYSIS_30M,
  activity:[{time:'Now',agent:'OPPORTUNITY',text:'Opportunity dashboard initialized.'},{time:'Now',agent:'ALGORITHM',text:'Trend board initialized.'}],
  meeting:{title:'Strategy Meeting',status:'Ready for evidence',decision:{stop:'Using unverified numbers in external pitches',start:'Building category-specific evidence packages',keep:'Honest review positioning',test:'Which DTL categories create the strongest sponsor response',immediate:'Collect verified analytics and rank outreach opportunities'}},
  gamePlan:{headline:'Build evidence, then turn it into reach and revenue.',postNow:[{platform:'TikTok',action:'Lead with a clear first-second premise and only use trend tags that actually match the post.'},{platform:'Instagram',action:'Package Reels for discovery while tracking native monetization separately.'},{platform:'YouTube',action:'Prioritize long-form retention and qualified watch-hour growth.'}]},
  verdicts:[],analytics:[]
};

let memoryState=JSON.parse(JSON.stringify(SEED_STATE));let pool=null;let dbReady=false;let server=null;
app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));

function inferCategory(o={}){const s=`${o.category||''} ${o.type||''} ${o.compensation||''}`.toLowerCase();if(s.includes('sponsor')||s.includes('paid'))return 'sponsor';if(s.includes('affiliate')||s.includes('commission'))return 'affiliate';return 'free_product'}
function genericEmail(o){return `Subject: Down The Line Podcast x ${o.brand||'Brand'}\n\nHi ${o.brand||'Brand'} Team,\n\nI’m reaching out from Down The Line Podcast. We create entertainment-driven content across TikTok, Instagram, and YouTube and would love to explore a collaboration that fits naturally with our audience.\n\nWe’d like to discuss a paid opportunity first when budget is available, while remaining open to affiliate or gifted-product options when the fit is strong. Any relationship would be clearly disclosed, and we never promise a positive review or guaranteed coverage.\n\nBest,\nDown The Line Podcast`}
function normalizeOpportunity(o){return {...o,category:o.category||inferCategory(o),shortDescription:o.shortDescription||o.why||'Open creator opportunity',website:o.website||((o.source||'').startsWith('http')?o.source:null),productUrl:o.productUrl||o.website||null,contactUrl:o.contactUrl||o.website||null,contactMethod:o.contactMethod||o.contact||'Use the official application/contact route.',partnership:o.partnership||o.why||'Potential creator partnership.',fitReason:o.fitReason||o.why||'Fit should be re-evaluated against current DTL content.',emailTemplate:o.emailTemplate||genericEmail(o)}}
function normalizeState(state){state=state||{};state.meta=state.meta||{};state.platforms=Array.isArray(state.platforms)?state.platforms:SEED_STATE.platforms;state.agents=Array.isArray(state.agents)?state.agents:SEED_STATE.agents;let opps=Array.isArray(state.opportunities)?state.opportunities.filter(o=>o.id!=='seed-1'):[];if(!opps.length)opps=DEFAULT_OPPORTUNITIES;state.opportunities=opps.map(normalizeOpportunity);if(!state.trends||!Array.isArray(state.trends.hashtags)||!state.trends.hashtags.length)state.trends=JSON.parse(JSON.stringify(DEFAULT_TRENDS));if(!state.analysis30m)state.analysis30m=JSON.parse(JSON.stringify(DEFAULT_ANALYSIS_30M));state.activity=Array.isArray(state.activity)?state.activity:[];state.meeting=state.meeting||SEED_STATE.meeting;state.gamePlan=state.gamePlan||SEED_STATE.gamePlan;return state}

async function tryInitDb(){if(!process.env.DATABASE_URL){console.log('DATABASE_URL not set; using in-memory state');return}try{pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},connectionTimeoutMillis:5000});await pool.query('SELECT 1');await pool.query(`CREATE TABLE IF NOT EXISTS war_room_state (id INTEGER PRIMARY KEY,payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);const {rows}=await pool.query('SELECT payload FROM war_room_state WHERE id=1');if(!rows.length){await pool.query('INSERT INTO war_room_state (id,payload) VALUES (1,$1)',[normalizeState(memoryState)]);}else{const normalized=normalizeState(rows[0].payload);memoryState=normalized;await pool.query('UPDATE war_room_state SET payload=$1,updated_at=NOW() WHERE id=1',[normalized]);}dbReady=true;console.log('PostgreSQL connected')}catch(err){dbReady=false;console.error('PostgreSQL unavailable; continuing with in-memory state:',err.message)}}
async function getState(){if(dbReady&&pool){try{const {rows}=await pool.query('SELECT payload FROM war_room_state WHERE id=1');if(rows[0]?.payload){memoryState=normalizeState(rows[0].payload);return memoryState}}catch(err){console.error('Database read failed; using memory state:',err.message)}}memoryState=normalizeState(memoryState);return memoryState}
async function saveState(state){state=normalizeState(state);state.meta.updatedAt=new Date().toISOString();state.meta.mode=dbReady?'postgres':'memory';memoryState=state;if(dbReady&&pool)await pool.query('UPDATE war_room_state SET payload=$1,updated_at=NOW() WHERE id=1',[state]);return state}
function authorized(req){const token=process.env.INGEST_TOKEN;if(!token)return true;return req.headers.authorization===`Bearer ${token}`}
function sendStatic(res,fileName,type,maxAge='public, max-age=86400'){const filePath=path.join(__dirname,fileName);if(!fs.existsSync(filePath))return res.status(404).end();res.set('Cache-Control',maxAge);return res.type(type).sendFile(filePath)}
app.get('/logo.png',(_req,res)=>sendStatic(res,'logo.png','png','no-store'));
app.get('/title-logo-v3.png',(_req,res)=>sendStatic(res,'title-logo-v3.png','png','no-store'));
app.get('/health',(_req,res)=>res.status(200).json({ok:true,service:'dtl-war-room',database:dbReady?'connected':'memory-fallback',frontend:'clean-hero-platform-first-v2',time:new Date().toISOString()}));
app.get('/api/state',async(_req,res)=>{try{res.set('Cache-Control','no-store');res.json(await getState())}catch(err){res.status(500).json({error:'Unable to load War Room state',detail:err.message})}});
app.post('/api/ingest',async(req,res)=>{if(!authorized(req))return res.status(401).json({error:'Unauthorized'});try{const state=await getState();const event=req.body||{};for(const key of ['platforms','agents','meeting','gamePlan','opportunities','verdicts','analytics','trends','analysis30m'])if(event[key]!==undefined)state[key]=event[key];if(event.activity)state.activity=[...event.activity,...(state.activity||[])].slice(0,100);res.json({ok:true,state:await saveState(state)})}catch(err){res.status(500).json({error:err.message})}});
app.post('/api/trends',async(req,res)=>{if(!authorized(req))return res.status(401).json({error:'Unauthorized'});try{const state=await getState();state.trends={...(state.trends||{}),...(req.body||{}),lastUpdated:req.body?.lastUpdated||new Date().toISOString()};await saveState(state);res.json({ok:true,trends:state.trends})}catch(err){res.status(500).json({error:err.message})}});
app.post('/api/analysis30m',async(req,res)=>{if(!authorized(req))return res.status(401).json({error:'Unauthorized'});try{const state=await getState();state.analysis30m={...(state.analysis30m||{}),...(req.body||{}),updatedAt:req.body?.updatedAt||new Date().toISOString()};await saveState(state);res.json({ok:true,analysis30m:state.analysis30m})}catch(err){res.status(500).json({error:err.message})}});
app.post('/api/agents/:id',async(req,res)=>{if(!authorized(req))return res.status(401).json({error:'Unauthorized'});try{const state=await getState();const id=String(req.params.id||'').toLowerCase();const index=(state.agents||[]).findIndex(a=>String(a.id).toLowerCase()===id);if(index<0)return res.status(404).json({error:'Agent not found'});const updated={...state.agents[index],...(req.body||{}),id:state.agents[index].id,taskUpdatedAt:new Date().toISOString()};state.agents[index]=updated;state.activity=[{time:'Now',agent:updated.name,text:`Current task updated: ${updated.targetTitle||updated.videoTitle||updated.current||'assignment changed'}`},...(state.activity||[])].slice(0,100);await saveState(state);res.json({ok:true,agent:updated})}catch(err){res.status(500).json({error:err.message})}});
app.post('/api/opportunities',async(req,res)=>{if(!authorized(req))return res.status(401).json({error:'Unauthorized'});try{const state=await getState();const body=req.body||{};const item=normalizeOpportunity({...body,id:body.id||`opp-${Date.now()}`,createdAt:new Date().toISOString()});state.opportunities=[item,...(state.opportunities||[]).filter(x=>x.id!==item.id&&x.id!=='seed-1')];state.activity=[{time:'Now',agent:'OPPORTUNITY',text:`New opportunity: ${item.brand||'Unnamed lead'}`},...(state.activity||[])].slice(0,100);await saveState(state);res.json({ok:true,item})}catch(err){res.status(500).json({error:err.message})}});
app.get('/',(_req,res)=>res.status(200).type('html').send(PAGE));app.get('/opportunity/:id',(_req,res)=>res.status(200).type('html').send(PAGE));app.use((req,res,next)=>{if(req.method!=='GET')return next();res.status(200).type('html').send(PAGE)});app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Server error'})});
server=app.listen(PORT,HOST,()=>{console.log(`DTL War Room listening on http://${HOST}:${PORT}`);tryInitDb()});
async function shutdown(signal){console.log(`${signal} received; shutting down cleanly`);if(server)server.close(async()=>{try{if(pool)await pool.end()}catch(_){}process.exit(0)});setTimeout(()=>process.exit(0),5000).unref()}process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
