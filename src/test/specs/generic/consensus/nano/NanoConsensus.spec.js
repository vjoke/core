describe('NanoConsensus', () => {
    const copyChain = async (bcFrom, bcTo) => {
        for (let i = 2; i <= bcFrom.height; i++) {
            const block = await bcFrom.getBlockAt(i, true);
            const status = await bcTo.pushBlock(block);
            expect(status).toBe(FullChain.OK_EXTENDED);
        }
    };

    beforeEach(() => {
        MockClock.install();
        MockClock.speed = 10;

        MockNetwork.install(20); // 20ms delay
    });

    afterEach(() => {
        MockClock.uninstall();
        MockNetwork.uninstall();
    });

    it('can sync a blockchain', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(10, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain, consensus1.blockchain);
            expect(consensus1.blockchain.head.equals(blockchain.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(11);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            expect(consensus2.blockchain.head.equals(GenesisConfig.GENESIS_BLOCK)).toBe(true);
            consensus2.network.connect();

            await new Promise(resolve => consensus2.on('established', resolve));
            expect(consensus2.blockchain.headHash.equals(blockchain.headHash)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);
        })().then(done, done.fail);
    });

    it('will adopt the harder chain', (done) => {
        (async () => {
            // Peer 1
            const blockchain1 = await TestBlockchain.createVolatileTest(8, 2);
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain1, consensus1.blockchain);
            expect(consensus1.blockchain.head.equals(blockchain1.head)).toBe(true);
            expect(consensus1.blockchain.height).toBe(9);
            consensus1.network.connect();

            // Peer 2
            const blockchain2 = await TestBlockchain.createVolatileTest(10, 10);
            const netConfig2 = new WsNetworkConfig('node2.test', 8080, 'key2', 'cert2');
            const consensus2 = await Consensus.volatileFull(netConfig2);
            consensus2.network.allowInboundConnections = true;
            await copyChain(blockchain2, consensus2.blockchain);
            expect(consensus2.blockchain.head.equals(blockchain2.head)).toBe(true);
            expect(consensus2.blockchain.height).toBe(11);

            // Peer 3
            const netConfig3 = new RtcNetworkConfig();
            const consensus3 = await Consensus.volatileNano(netConfig3);

            // Connect to peer 1.
            consensus3.network.connect();
            await new Promise(resolve => consensus3.on('established', resolve));
            expect(consensus3.blockchain.headHash.equals(blockchain1.headHash)).toBe(true);
            expect(consensus3.blockchain.height).toBe(9);

            // Connect to peer 2.
            consensus3.network._connections.connectOutbound(netConfig2.peerAddress);

            setTimeout(() => {
                expect(consensus3.blockchain.headHash.equals(blockchain2.headHash)).toBe(true);
                expect(consensus3.blockchain.height).toBe(11);
                done();
            }, 10000);
        })().catch(done.fail);
    });

    it('stays up to date', (done) => {
        (async () => {
            const minFullNodes = BaseConsensus.MIN_FULL_NODES;
            BaseConsensus.MIN_FULL_NODES = 0;

            const blockchain = await TestBlockchain.createVolatileTest(3, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            consensus2.network.connect();

            await new Promise(resolve => consensus2.on('established', resolve));

            // Wait for subscribe messages to go through.
            MockClock.tick(1000);

            await copyChain(blockchain, consensus1.blockchain);

            setTimeout(() => {
                expect(consensus1.blockchain.head.equals(blockchain.head)).toBe(true);
                expect(consensus1.blockchain.height).toBe(4);
                expect(consensus2.blockchain.headHash.equals(blockchain.headHash)).toBe(true);
                expect(consensus2.blockchain.height).toBe(4);

                BaseConsensus.MIN_FULL_NODES = minFullNodes;
                done();
            }, 10000);
        })().catch(done.fail);
    });

    it('relays transactions', (done) => {
        (async () => {
            const minFullNodes = BaseConsensus.MIN_FULL_NODES;
            BaseConsensus.MIN_FULL_NODES = 0;

            const [user1, user2] = TestBlockchain.getUsers(2);
            const transaction = TestBlockchain.createTransaction(user1.publicKey, user2.address, 1000, 1, 1, user1.privateKey);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            consensus2.subscribeAccounts([user1.address]);
            consensus2.network.connect();

            await new Promise(resolve => consensus2.on('established', resolve));

            // Wait for subscribe messages to go through.
            MockClock.tick(4000);

            expect(consensus1.mempool.length).toBe(0);
            expect(consensus2.mempool.length).toBe(0);

            const status = await consensus1.mempool.pushTransaction(transaction);
            expect(status).toBe(Mempool.ReturnCode.ACCEPTED);

            expect(consensus1.mempool.length).toBe(1);
            expect(consensus2.mempool.length).toBe(0);

            consensus2.mempool.on('transaction-added', tx => {
                expect(tx.equals(transaction)).toBe(true);

                BaseConsensus.MIN_FULL_NODES = minFullNodes;
                done();
            });
        })().catch(done.fail);
    });

    it('can request account proofs', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(10, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain, consensus1.blockchain);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            expect(consensus2.blockchain.head.equals(GenesisConfig.GENESIS_BLOCK)).toBe(true);
            consensus2.network.connect();
            await new Promise(resolve => consensus2.on('established', resolve));

            const address = blockchain.users[1].address;
            const account = await consensus2.getAccount(address);
            expect((new BasicAccount(209202184)).equals(account)).toBe(true);
        })().then(done, done.fail);
    });

    it('can request transaction proofs', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(10, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain, consensus1.blockchain);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            expect(consensus2.blockchain.head.equals(GenesisConfig.GENESIS_BLOCK)).toBe(true);
            consensus2.network.connect();
            await new Promise(resolve => consensus2.on('established', resolve));

            const address = blockchain.users[1].address;
            const transactions = await consensus2._requestTransactionsProof([address]);
            expect(transactions.length).toBe(2);
        })().then(done, done.fail);
    });

    it('can request transaction history (all blocks known)', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(10, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain, consensus1.blockchain);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            expect(consensus2.blockchain.head.equals(GenesisConfig.GENESIS_BLOCK)).toBe(true);
            consensus2.network.connect();
            await new Promise(resolve => consensus2.on('established', resolve));

            const address = blockchain.users[1].address;
            const history = await consensus2._requestTransactionHistory(address);
            expect(history.length).toBe(37);
        })().then(done, done.fail);
    });

    xit('can request block proofs', (done) => {
        (async () => {
            const blockchain = await TestBlockchain.createVolatileTest(10, 10);

            // Peer 1
            const netConfig1 = Dummy.NETCONFIG;
            const consensus1 = await Consensus.volatileFull(netConfig1);
            await copyChain(blockchain, consensus1.blockchain);
            consensus1.network.connect();

            // Peer 2
            const netConfig2 = new RtcNetworkConfig();
            const consensus2 = await Consensus.volatileNano(netConfig2);
            expect(consensus2.blockchain.head.equals(GenesisConfig.GENESIS_BLOCK)).toBe(true);
            consensus2.network.connect();
            await new Promise(resolve => consensus2.on('established', resolve));

            // TODO
        })().then(done, done.fail);
    });
});
